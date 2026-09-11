/**
 * Verifies the platform client against the shapes Core actually produces.
 *
 *   npm run verify:platform
 *
 * ===========================================================================
 * WHY THIS EXISTS: "CONFIRM YOU ARE READING THE REAL RESPONSE RATHER THAN A
 * SHAPE YOU EXPECT."
 * ===========================================================================
 *
 * The success body on this class is NOT the Action-class envelope. It was
 * checked in the implementation rather than assumed:
 *
 *   platform-routes.ts   ends its dispatch with `ok(outcome.value.body)`
 *   http/api.ts:364      passes that straight to `renderSuccess`
 *   http/response.ts:102 is `JSON.stringify(payload)`, no wrapping
 *
 * So `data` and `next_cursor` are TOP-LEVEL keys. The single most likely way to
 * get this wrong is to write `body.data.data` — or to cast the response and read
 * `undefined` — and the check below that matters most is the one asserting an
 * ENVELOPED body is REJECTED. A client that accepted both shapes would be a
 * client that could not tell which one it got.
 *
 * IT IMPORTS THE REAL MODULE and drives it through an injected `fetch`, so what
 * is exercised is the shipped `platform.ts`, not a description of it. No network
 * is touched and no server is needed.
 *
 * EVERY IDENTIFIER BELOW IS SYNTHETIC. `.claude/rules/security.md` §6.
 */

import {
  createPlatformClient,
  parseListOrganizations,
  parseListTemplates,
  parseOnboardOrganization,
  parseOrganizationDetail,
  parseOrganizationFeed,
  parsePlatformFeed,
  parseListOperators,
  parseResolveMember,
  parseOrganizationIdentity,
  parseRegistrationRecord,
  isKnownAuditOutcome,
  isKnownPlatformRole,
  isKnownRegistrationState,
  displayNameRefusal,
  registrationNumberRefusal,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_REGISTRATION_NUMBER_LENGTH,
  MAX_TEMPLATE_NAME_LENGTH,
  MAX_TEMPLATE_LABEL_LENGTH,
  toUtcExclusiveDayEnd,
  toUtcDayStart,
  parseTemplate,
  parseWhoami,
  isKnownMembershipRole,
  isKnownOnboardingWarning,
  isKnownStatus,
  ONBOARDING_WARNINGS,
  DISCARDED_WORKSPACE_NAME_PLACEHOLDER,
  templateLabelRefusal,
  templateNameRefusal,
  ORGANIZATIONS_PATH,
  TEMPLATES_PATH,
  WHOAMI_PATH,
  PLATFORM_BASE_PATH,
  PLATFORM_DEFAULT_PAGE_SIZE,
  PLATFORM_MAX_PAGE_SIZE,
} from '../src/api/platform.ts';
import { probeOperatorSession } from '../src/api/platform-session.ts';
/*
 * THE REAL GENERATOR, imported rather than reimplemented. It lives in its own
 * module precisely so this import is possible — `onboarding-credential.ts`
 * pulls in the Web Worker and cannot be loaded under Node. For a value whose
 * only job is to be unguessable, testing a copy would verify nothing.
 */
import {
  generateAdminPassword,
  GENERATED_PASSWORD_LENGTH,
} from '../src/api/generate-password.ts';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Comment-stripping, so a rule quoted in prose is not read as code.
 *
 * HOISTED TO THE TOP 2026-09-09, AFTER IT BIT THE AUTHOR OF THE WARNING ABOUT
 * IT. It was declared beside `readScreen` in section 10 and used for the first
 * time in section 2, which is a temporal-dead-zone `ReferenceError` at run time
 * rather than a compile error — the same shape that produced a blank admin
 * console when `route-tree` and `root-layout` formed a cycle, and the same one
 * this file's `queriesSource` comment warns about **twelve hundred lines below
 * where the mistake was then made.**
 *
 * **Knowing the rule did not confer the ability to see the case**, which is
 * `workflow.md` §11a's point about skip-sets, and it was caught only because
 * the run crashed loudly. A shared helper belongs above every user of it.
 */
const strip = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * The dictionary, read once at module scope.
 *
 * **DECLARED HERE BECAUSE ASSERTIONS ABOUT USER-FACING TEXT NOW LIVE IN TWO
 * PLACES.** A screen names a message key; the sentence itself is in `i18n.tsx`.
 * So a check about what the console SAYS reads this, and a check about what a
 * screen USES reads the screen — and putting this at the top keeps both
 * available without the temporal-dead-zone crash that `strip` caused when it
 * was declared beside its second user instead of above its first.
 */
const i18nSource = strip(
  readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'i18n.tsx'), 'utf8'),
);
/*
 * The shared identifier check, imported so the non-ASCII sentinel below is
 * derived from the real function rather than from a copied sentence. `kdf.ts`
 * imports nothing, so a bare loader resolves it.
 */
import { identifierRefusal } from '@dudo/client-kdf';
import {
  ApiError,
  ERROR_CODES,
  errorBodyKey,
  errorTitleKey,
  writeIsCertainlyAbsent,
} from '../src/api/errors.ts';
import {
  MAX_WINDOW_DAYS,
  describeWindowRefusal,
  shiftWindowByOwnLength,
  spanInDays,
  windowIsRequired,
  windowRefusal,
  windowRefusalToken,
} from '../src/api/audit-window.ts';
import {
  buildConfirmedRequest,
  declaredPathParameters,
  isPresentableStatement,
  parseConfirmationChallenge,
  withConfirmation,
} from '../src/api/confirmation.ts';

let failures = 0;

function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}` +
      (ok
        ? ''
        : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`),
  );
}

function checkTrue(name, actual) {
  check(name, actual, true);
}

async function checkThrows(name, run, expectedCode) {
  try {
    await run();
    failures += 1;
    console.log(`FAIL  ${name}\n        expected a throw with code ${expectedCode}, got none`);
  } catch (thrown) {
    check(name, thrown?.code, expectedCode);
  }
}

/** A `fetch` that answers once, and records what it was asked. */
function stubFetch(response) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  return { impl, calls };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/* =========================================================================
   1. PATHS AND CONSTANTS
   ========================================================================= */

console.log('\n=== Paths and constants, against platform-routes.ts ===\n');

check('base path', PLATFORM_BASE_PATH, '/api/v1/platform');
check('whoami path', WHOAMI_PATH, '/api/v1/platform/whoami');
check('organizations path', ORGANIZATIONS_PATH, '/api/v1/platform/organizations');
check('templates path', TEMPLATES_PATH, '/api/v1/platform/templates');
check('default page size', PLATFORM_DEFAULT_PAGE_SIZE, 25);
check('max page size', PLATFORM_MAX_PAGE_SIZE, 100);

/* =========================================================================
   2. THE SUCCESS BODY IS THE RESPONSE — NO ENVELOPE
   ========================================================================= */

console.log('\n=== whoami: the real shape, and the wrong ones ===\n');

/*
 * Exactly what `whoami()` in platform-route-handlers.ts returns.
 *
 * THE PRINCIPAL ID IS SYNTHETIC; THE SIX PERMISSION IDS ARE THE REAL ONES, read
 * off `platform-permissions.ts:110-115` and in the order
 * `PLATFORM_PERMISSION_ENVELOPE.declared` lists them. They are real because a
 * fixture carrying invented identifiers is a fixture someone later copies as
 * truth — I had `core.principal.reset-credential` here from memory and it is
 * `core.credential.reset`.
 *
 * NOTHING BELOW ASSERTS ON THESE VALUES. The client does not interpret a
 * permission id — it renders the list and never branches on it — so these
 * exercise the SHAPE only. That is deliberate: a client that recognised specific
 * permission ids would be a client holding permission logic, which ADR 0010 §7
 * forbids.
 *
 * It is `platform-admin`'s SIX, not the eight the role holds:
 * `reachablePlatformPermissions` intersects the role's grants with the envelope,
 * so `core.principal.grant-platform-scope` and `core.marketplace.moderate` are
 * deliberately not reported — no route can reach them.
 */
const WHOAMI_BODY = {
  principal_id: 'pr_synthetic_00000001',
  platform_role: 'platform-admin',
  permissions: [
    'core.organization.list',
    'core.organization.create',
    'core.template.read',
    'core.template.list',
    'core.template.create',
    'core.credential.reset',
  ],
};

const whoami = parseWhoami(WHOAMI_BODY);
check('principal_id is read from the top level', whoami.principal_id, 'pr_synthetic_00000001');
check('platform_role is read from the top level', whoami.platform_role, 'platform-admin');
check('permissions length', whoami.permissions.length, 6);

/*
 * THE CHECK THAT MATTERS MOST. If a proxy, a future refactor or a partial deploy
 * ever wrapped the body in the Action-class envelope, this client must REFUSE it
 * rather than read `undefined` fields and render blanks.
 */
try {
  parseWhoami({ data: WHOAMI_BODY });
  failures += 1;
  console.log('FAIL  an ENVELOPED whoami body is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  an ENVELOPED whoami body is refused, not silently misread');
}

try {
  parseWhoami({ principal_id: 'pr_x', platform_role: 'platform-admin' });
  failures += 1;
  console.log('FAIL  a missing "permissions" is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  a missing "permissions" is refused');
}

try {
  parseWhoami({ ...WHOAMI_BODY, permissions: [1, 2] });
  failures += 1;
  console.log('FAIL  a non-string permission is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  a non-string permission is refused');
}

console.log('\n=== organizations.list: the real shape ===\n');

// Exactly what `listOrganizations()` emits, including `display_name: null`.
const LIST_BODY = {
  data: [
    {
      organization_id: 'og_synthetic_0000000001',
      status: 'active',
      created_at: '2026-09-05T09:00:00Z',
      display_name: null,
    },
    {
      organization_id: 'og_synthetic_0000000002',
      status: 'suspended',
      created_at: '2026-09-04T08:30:00Z',
      display_name: null,
    },
  ],
  next_cursor: null,
};

const page = parseListOrganizations(LIST_BODY);
check('data is read from the TOP LEVEL, not body.data.data', page.data.length, 2);
check('organization_id', page.data[0].organization_id, 'og_synthetic_0000000001');
check('status is carried through as a string', page.data[0].status, 'active');
check('display_name is null and stays null', page.data[0].display_name, null);
check('next_cursor null', page.next_cursor, null);
check('a cursor is carried through', parseListOrganizations({ ...LIST_BODY, next_cursor: 'c_abc' }).next_cursor, 'c_abc');

try {
  parseListOrganizations({ data: { data: LIST_BODY.data }, next_cursor: null });
  failures += 1;
  console.log('FAIL  a DOUBLE-ENVELOPED list is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  a DOUBLE-ENVELOPED list is refused, not silently misread');
}

try {
  parseListOrganizations({ data: [{ organization_id: 'og_x', status: 'active' }], next_cursor: null });
  failures += 1;
  console.log('FAIL  a row missing created_at is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  a row missing created_at is refused');
}

/*
 * `display_name` MUST BE PRESENT. The schema requires the key and the handler
 * emits it always-and-null, precisely so that absent-versus-null is not a
 * distinction two clients resolve differently. A row without it is a contract
 * violation and is refused rather than defaulted.
 */
try {
  parseListOrganizations({
    data: [{ organization_id: 'og_x', status: 'active', created_at: '2026-09-05T09:00:00Z' }],
    next_cursor: null,
  });
  failures += 1;
  console.log('FAIL  a row with display_name ABSENT is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  a row with display_name ABSENT is refused (absent is not null)');
}

console.log('\n=== status is not narrowed by a cast ===\n');
checkTrue('active is known', isKnownStatus('active'));
checkTrue('suspended is known', isKnownStatus('suspended'));
check('an unexpected status is NOT claimed as known', isKnownStatus('archived'), false);
check(
  'an unexpected status still parses and is carried through verbatim',
  parseListOrganizations({
    data: [{ ...LIST_BODY.data[0], status: 'archived' }],
    next_cursor: null,
  }).data[0].status,
  'archived',
);

/*
 * ===========================================================================
 * NO TYPE GUARD MAY NARROW TO AN `extensible` WIRE TYPE
 * ===========================================================================
 *
 * `0041` splits every extensible enum in two: the WIRE type carries
 * `(string & {})` because an unlearned value may arrive, and the KNOWN SUBSET
 * is what this build understands. **A guard must narrow to the second.**
 *
 * **Narrowing to the wire type proves nothing and nothing goes red.** The
 * `(string & {})` arm absorbs every string, so `value is PlatformRole` against
 * the generated union is a predicate that always holds — the branch after it is
 * BELIEVED rather than checked, the compiler is satisfied, and every existing
 * case here still passes because they test values, not types.
 *
 * **The trap is one import away and it looks like a correction.** The contract
 * exports `PlatformRole`, `TemplateStatus`, `MembershipRole` and
 * `OrganizationStatus` — the names these guards USED to narrow to — so
 * "shouldn't this use the generated type?" is the natural next edit and it is
 * exactly wrong. Hence the `Known` prefix, and hence this check.
 */
{
  const source = strip(
    readFileSync(join(import.meta.dirname, '..', 'src', 'api', 'platform.ts'), 'utf8'),
  );
  const guards = [
    ...source.matchAll(/export function (isKnown\w+)\([^)]*\):\s*\w+\s+is\s+(\w+)/gu),
  ].map((match) => ({ guard: match[1], narrowsTo: match[2] }));

  console.log(
    `  … ${String(guards.length)} type guard(s): ${guards.map((g) => `${g.guard} -> ${g.narrowsTo}`).join(', ')}`,
  );
  /*
   * THE FLOOR. An empty list satisfies "none narrows wrongly" perfectly, so a
   * regex that stopped matching would report success having examined nothing.
   */
  checkTrue('the type-guard population is not empty', guards.length >= 4);

  /*
   * ⚠ THE FIRST VERSION OF THIS ASSERTION WAS KEYED ON THE `Known` PREFIX AND
   * WAS WRONG. It failed three guards that are entirely correct —
   * `isKnownAuditOutcome`, `isKnownRegistrationState`, `isKnownOnboardingWarning`
   * — because **a CLOSED enum has no wire/known split at all**, so its guard
   * legitimately narrows to the exact union and a `Known` prefix there would
   * distinguish it from nothing.
   *
   * **It was checking a naming convention while claiming to check a property**
   * — `workflow.md` §11a's "derive the subject, never transcribe it", and the
   * transcribed thing here was my own new convention, which is the easiest kind
   * to mistake for a rule.
   *
   * **THE ACTUAL PROPERTY: a guard must narrow to a type this file DECLARES,
   * never to one it IMPORTS from `@dudo/contracts`.** That is what makes the
   * hazard checkable without a convention: an imported enum type may carry the
   * `(string & {})` arm, which absorbs every string, so the predicate would
   * always hold and the branch after it would be believed rather than checked.
   * A locally declared literal union cannot do that.
   *
   * It also catches the case the prefix rule would have missed entirely — a
   * guard narrowing to an imported CLOSED enum, which compiles, reads as
   * tidier, and quietly couples a client's branch set to a contract that may
   * widen later.
   */
  const importedTypes = new Set(
    [...source.matchAll(/import type \{([^}]*)\} from '@dudo\/contracts[^']*'/gu)]
      .flatMap((match) => match[1].split(','))
      .map((name) => name.trim().split(/\s+as\s+/u).pop())
      .filter((name) => name !== undefined && name !== ''),
  );
  const locallyDeclared = new Set(
    [...source.matchAll(/export (?:type|interface) (\w+)[\s=<{]/gu)].map((match) => match[1]),
  );
  console.log(
    `  … ${String(locallyDeclared.size)} type(s) declared here · ${String(importedTypes.size)} imported from @dudo/contracts`,
  );
  checkTrue('both type populations are non-empty', locallyDeclared.size >= 10 && importedTypes.size >= 1);
  check(
    'no guard narrows to a type imported from the contract package',
    guards
      .filter((g) => importedTypes.has(g.narrowsTo) || !locallyDeclared.has(g.narrowsTo))
      .map((g) => `${g.guard} -> ${g.narrowsTo}`)
      .join(','),
    '',
  );
}

/* =========================================================================
   3. THE REQUEST
   ========================================================================= */

console.log('\n=== The request Core receives ===\n');

{
  const { impl, calls } = stubFetch(jsonResponse(WHOAMI_BODY));
  await createPlatformClient({ fetchImpl: impl }).whoami();
  check('whoami calls the whoami path', calls[0].url, '/api/v1/platform/whoami');
  check('whoami is a GET', calls[0].init.method, 'GET');
  check('the session cookie is attached', calls[0].init.credentials, 'same-origin');
  check('no body is sent on a GET', calls[0].init.body, undefined);
  check('redirects are refused', calls[0].init.redirect, 'error');
}

{
  const { impl, calls } = stubFetch(jsonResponse(LIST_BODY));
  await createPlatformClient({ fetchImpl: impl }).listOrganizations({ pageSize: 25, cursor: null });
  check(
    'a NULL cursor is OMITTED, never sent empty',
    calls[0].url,
    '/api/v1/platform/organizations?page_size=25',
  );
}

{
  const { impl, calls } = stubFetch(jsonResponse(LIST_BODY));
  await createPlatformClient({ fetchImpl: impl }).listOrganizations({ pageSize: 25, cursor: '' });
  check(
    'an EMPTY cursor is OMITTED too (Core refuses ?cursor=)',
    calls[0].url,
    '/api/v1/platform/organizations?page_size=25',
  );
}

{
  const { impl, calls } = stubFetch(jsonResponse(LIST_BODY));
  await createPlatformClient({ fetchImpl: impl }).listOrganizations({
    pageSize: 25,
    cursor: 'c_abc+/=',
  });
  checkTrue(
    'a real cursor is sent, URL-encoded',
    calls[0].url.includes('cursor=c_abc%2B%2F%3D'),
  );
}

{
  const { impl, calls } = stubFetch(jsonResponse(LIST_BODY));
  await createPlatformClient({ fetchImpl: impl }).listOrganizations();
  check(
    'no options sends no query at all (Core applies its own default)',
    calls[0].url,
    '/api/v1/platform/organizations',
  );
}

/* =========================================================================
   4. FAILURES — the ordinary error envelope
   ========================================================================= */

console.log('\n=== Failure envelopes and status mapping ===\n');

const ENVELOPE = (code, message) =>
  jsonResponse({ error: { code, message, request_id: 'rq_synthetic_01' } }, statusFor(code));

/**
 * `kernel/errors.ts::HTTP_STATUS_BY_CODE`, copied exactly.
 *
 * NOTE `rate_limited` AND `quota_exceeded` SHARE 429. That is the whole reason
 * the client reads the code from the envelope body rather than inferring it from
 * the status — and it is why this table is transcribed rather than guessed.
 *
 * THIS HELPER WAS ITSELF THE BUG ONCE: it omitted `conflict` and
 * `quota_exceeded`, returned `undefined`, and `new Response(body, {status:
 * undefined})` is a **200**. So two failure tests were quietly asserting against
 * a success response. A missing entry must be loud, hence the throw.
 */
const HTTP_STATUS_BY_CODE = {
  invalid_argument: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  failed_precondition: 422,
  rate_limited: 429,
  quota_exceeded: 429,
  internal: 500,
  unavailable: 503,
  timeout: 504,
};

function statusFor(code) {
  const status = HTTP_STATUS_BY_CODE[code];
  if (status === undefined) {
    throw new Error(
      `No HTTP status recorded for "${code}". Add it from kernel/errors.ts rather than ` +
        'letting it default — an undefined status becomes a 200 and turns a failure test into a ' +
        'success test.',
    );
  }
  return status;
}

for (const [code, expected] of [
  ['unauthenticated', 'unauthenticated'],
  ['forbidden', 'forbidden'],
  ['invalid_argument', 'invalid_argument'],
  ['rate_limited', 'rate_limited'],
  ['unavailable', 'unavailable'],
  ['internal', 'internal'],
  ['not_found', 'not_found'],
]) {
  const { impl } = stubFetch(ENVELOPE(code, 'synthetic'));
  await checkThrows(
    `${String(statusFor(code))} maps to ${expected}`,
    () => createPlatformClient({ fetchImpl: impl }).whoami(),
    expected,
  );
}

{
  const { impl } = stubFetch(ENVELOPE('unauthenticated', 'synthetic'));
  try {
    await createPlatformClient({ fetchImpl: impl }).whoami();
  } catch (thrown) {
    check('the request_id is carried off the envelope', thrown.request_id, 'rq_synthetic_01');
  }
}

{
  const { impl } = stubFetch(
    jsonResponse({ error: { code: 'rate_limited', message: 'x', request_id: 'rq_2', retry_after_seconds: 30 } }, 429),
  );
  try {
    await createPlatformClient({ fetchImpl: impl }).whoami();
  } catch (thrown) {
    check('retry_after_seconds is read from the body', thrown.retry_after_seconds, 30);
  }
}

{
  // A body that is not JSON at all. The status is still the answer.
  const { impl } = stubFetch(new Response('<html>gateway</html>', { status: 503 }));
  await checkThrows(
    'a non-JSON error body still maps by status',
    () => createPlatformClient({ fetchImpl: impl }).whoami(),
    'unavailable',
  );
}

{
  // A 200 whose body is not JSON. This must NOT be reported as success.
  const { impl } = stubFetch(new Response('not json', { status: 200 }));
  await checkThrows(
    'a 200 with a non-JSON body is refused, not treated as empty',
    () => createPlatformClient({ fetchImpl: impl }).whoami(),
    'internal',
  );
}

/* =========================================================================
   5. THE PROBE — the four answers, and the one that must not be a login loop
   ========================================================================= */

console.log('\n=== probeOperatorSession: four answers ===\n');

{
  const { impl } = stubFetch(jsonResponse(WHOAMI_BODY));
  const probe = await probeOperatorSession(createPlatformClient({ fetchImpl: impl }));
  check('200 -> operator', probe.kind, 'operator');
  check('and it carries the context', probe.whoami?.platform_role, 'platform-admin');
}

{
  const { impl } = stubFetch(ENVELOPE('unauthenticated', 'x'));
  const probe = await probeOperatorSession(createPlatformClient({ fetchImpl: impl }));
  check('401 -> anonymous', probe.kind, 'anonymous');
}

{
  const { impl } = stubFetch(ENVELOPE('forbidden', 'x'));
  const probe = await probeOperatorSession(createPlatformClient({ fetchImpl: impl }));
  // THE ONE THAT MATTERS. `refused` and not `anonymous`: rendering a 403 as a
  // sign-in screen builds a loop that cannot terminate, because signing in again
  // produces another session that is refused in exactly the same way.
  check('403 -> refused, NOT anonymous', probe.kind, 'refused');
}

{
  const { impl } = stubFetch(ENVELOPE('unavailable', 'x'));
  const probe = await probeOperatorSession(createPlatformClient({ fetchImpl: impl }));
  check('503 -> unknown, NOT anonymous', probe.kind, 'unknown');
}

{
  const { impl } = stubFetch(ENVELOPE('not_found', 'x'));
  const probe = await probeOperatorSession(createPlatformClient({ fetchImpl: impl }));
  // A 404 here means the host does not serve platform routes, or the class is
  // not composed. A deployment fact, not a session fact.
  check('404 -> unknown (wrong host / class not composed)', probe.kind, 'unknown');
}

{
  // A 200 with a shape Core does not promise. It must NOT become `operator`.
  const { impl } = stubFetch(jsonResponse({ data: WHOAMI_BODY }));
  const probe = await probeOperatorSession(createPlatformClient({ fetchImpl: impl }));
  check('200 with an unreadable shape -> unknown, never operator', probe.kind, 'unknown');
}

/* =========================================================================
   6. TEMPLATES — template-v1
   ========================================================================= */

console.log('\n=== Templates: the real shape ===\n');

// Exactly what `toTemplateOutput()` in templates.ts emits.
const TEMPLATE_BODY = {
  template_id: 'tp_synthetic_0000000001',
  name: 'School',
  level_labels: { organization: 'Group', workspace: 'Campus', branch: 'Classroom' },
  status: 'active',
  created_at: '2026-09-05T10:00:00Z',
};

const template = parseTemplate(TEMPLATE_BODY);
check('template_id', template.template_id, 'tp_synthetic_0000000001');
check('name is carried verbatim', template.name, 'School');
check('the workspace label', template.level_labels.workspace, 'Campus');
check('status', template.status, 'active');

try {
  parseTemplate({ data: TEMPLATE_BODY });
  failures += 1;
  console.log('FAIL  an ENVELOPED template is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  an ENVELOPED template is refused, not silently misread');
}

/*
 * THE CHECK THAT PROTECTS THE ONE-CONTRACT RULE. `templateOutput` requires all
 * three labels and Core fills any the operator omitted, precisely so the two
 * clients cannot drift into different ideas of what an unlabelled level is
 * called. If this client silently substituted its own default for a missing
 * label, that guarantee would be defeated on this side and the defect would be
 * invisible — so a missing label is REFUSED.
 */
try {
  parseTemplate({ ...TEMPLATE_BODY, level_labels: { organization: 'Group', workspace: 'Campus' } });
  failures += 1;
  console.log('FAIL  a MISSING level label is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  a MISSING level label is refused, never defaulted on the client');
}

try {
  parseTemplate({ ...TEMPLATE_BODY, level_labels: 'Campus' });
  failures += 1;
  console.log('FAIL  a non-object level_labels is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  a non-object level_labels is refused');
}

const templatePage = parseListTemplates({ data: [TEMPLATE_BODY], next_cursor: null });
check('list data is TOP-LEVEL, not body.data.data', templatePage.data.length, 1);
check('list next_cursor', templatePage.next_cursor, null);
check(
  'zero templates is a valid page, not an error',
  parseListTemplates({ data: [], next_cursor: null }).data.length,
  0,
);

console.log('\n=== Templates: the request Core receives ===\n');

{
  const { impl, calls } = stubFetch(jsonResponse(TEMPLATE_BODY, 201));
  await createPlatformClient({ fetchImpl: impl }).createTemplate({ name: 'School' });
  check('create posts to /templates', calls[0].url, '/api/v1/platform/templates');
  check('create is a POST', calls[0].init.method, 'POST');
  check('create sends JSON', calls[0].init.headers['content-type'], 'application/json');
  check('the session cookie is attached', calls[0].init.credentials, 'same-origin');
  // Only the declared field. No template_id, no status — the operator chooses
  // neither, and Core refuses any undeclared field outright.
  check('a bare create sends ONLY name', calls[0].init.body, JSON.stringify({ name: 'School' }));
}

{
  /*
   * THE ONE MOST LIKELY TO BE GOT WRONG. Core refuses a zero-length label with
   * `out_of_range`, so a blank field must be OMITTED rather than sent as ''.
   * Omission is what selects the platform default.
   */
  const { impl, calls } = stubFetch(jsonResponse(TEMPLATE_BODY, 201));
  await createPlatformClient({ fetchImpl: impl }).createTemplate({
    name: 'School',
    level_labels: { organization: '', workspace: 'Campus', branch: '' },
  });
  check(
    'blank labels are OMITTED, never sent as empty strings',
    calls[0].init.body,
    JSON.stringify({ name: 'School', level_labels: { workspace: 'Campus' } }),
  );
}

{
  const { impl, calls } = stubFetch(jsonResponse(TEMPLATE_BODY, 201));
  await createPlatformClient({ fetchImpl: impl }).createTemplate({
    name: 'School',
    level_labels: { organization: '', workspace: '', branch: '' },
  });
  check(
    'all-blank labels omit level_labels entirely',
    calls[0].init.body,
    JSON.stringify({ name: 'School' }),
  );
}

{
  /*
   * CORE RETURNS 200 AND THE CONTRACT DECLARES 201 (http/api.ts:371 hardcodes
   * 200 for every platform route; PlatformRoute has no successStatus field).
   * This client accepts any 2xx, so it works against Core as it stands AND
   * against Core once corrected — encoding neither side's bug.
   */
  const { impl } = stubFetch(jsonResponse(TEMPLATE_BODY, 200));
  const created = await createPlatformClient({ fetchImpl: impl }).createTemplate({ name: 'School' });
  check('a 200 from create is accepted (Core returns 200 today)', created.name, 'School');
}
{
  const { impl } = stubFetch(jsonResponse(TEMPLATE_BODY, 201));
  const created = await createPlatformClient({ fetchImpl: impl }).createTemplate({ name: 'School' });
  check('a 201 from create is accepted (the contract declares 201)', created.name, 'School');
}

{
  const { impl, calls } = stubFetch(jsonResponse(TEMPLATE_BODY));
  await createPlatformClient({ fetchImpl: impl }).readTemplate('tp_abc');
  check('read puts the id in the PATH', calls[0].url, '/api/v1/platform/templates/tp_abc');
  check('read sends no body', calls[0].init.body, undefined);
}

{
  // The route declares no query parameters, so any query string is refused by
  // Core. A caller-supplied value must not be able to add path segments either.
  const { impl, calls } = stubFetch(jsonResponse(TEMPLATE_BODY));
  await createPlatformClient({ fetchImpl: impl }).readTemplate('a/b?c=d');
  check(
    'a hostile identifier is percent-encoded, not injected',
    calls[0].url,
    '/api/v1/platform/templates/a%2Fb%3Fc%3Dd',
  );
}

{
  const { impl, calls } = stubFetch(jsonResponse({ data: [], next_cursor: null }));
  await createPlatformClient({ fetchImpl: impl }).listTemplates({ pageSize: 25, cursor: null });
  check(
    'list omits a null cursor',
    calls[0].url,
    '/api/v1/platform/templates?page_size=25',
  );
}

console.log('\n=== Templates: failures ===\n');

{
  const { impl } = stubFetch(ENVELOPE('conflict', 'x'));
  await checkThrows(
    '409 maps to conflict (a duplicate name)',
    () => createPlatformClient({ fetchImpl: impl }).createTemplate({ name: 'School' }),
    'conflict',
  );
}
{
  const { impl } = stubFetch(ENVELOPE('quota_exceeded', 'x'));
  await checkThrows(
    '429-class quota_exceeded is surfaced, not collapsed',
    () => createPlatformClient({ fetchImpl: impl }).createTemplate({ name: 'School' }),
    'quota_exceeded',
  );
}
{
  const { impl } = stubFetch(ENVELOPE('invalid_argument', 'x'));
  await checkThrows(
    '400 maps to invalid_argument',
    () => createPlatformClient({ fetchImpl: impl }).createTemplate({ name: ' padded ' }),
    'invalid_argument',
  );
}
/*
 * THE 429 DISAMBIGUATION, BOTH DIRECTIONS. `rate_limited` and `quota_exceeded`
 * share status 429 in `kernel/errors.ts`, so only the envelope's `code` tells
 * them apart. Mislabelling a quota refusal as a rate limit tells an operator to
 * wait a moment when waiting will not help.
 */
{
  const { impl } = stubFetch(ENVELOPE('rate_limited', 'x'));
  await checkThrows(
    'a 429 carrying rate_limited stays rate_limited',
    () => createPlatformClient({ fetchImpl: impl }).createTemplate({ name: 'School' }),
    'rate_limited',
  );
}
{
  const { impl } = stubFetch(ENVELOPE('quota_exceeded', 'x'));
  await checkThrows(
    'the SAME 429 carrying quota_exceeded is NOT relabelled rate_limited',
    () => createPlatformClient({ fetchImpl: impl }).createTemplate({ name: 'School' }),
    'quota_exceeded',
  );
}
{
  // No readable envelope. The status is all there is, and `rate_limited` is the
  // conservative reading of a bare 429.
  const { impl } = stubFetch(new Response('<html>429</html>', { status: 429 }));
  await checkThrows(
    'a 429 with no readable envelope falls back to rate_limited',
    () => createPlatformClient({ fetchImpl: impl }).createTemplate({ name: 'School' }),
    'rate_limited',
  );
}

{
  // A 2xx whose body is not a Template. It must NOT be reported as created.
  const { impl } = stubFetch(jsonResponse({ ok: true }, 201));
  await checkThrows(
    'a 201 with an unreadable body is refused, never reported as created',
    () => createPlatformClient({ fetchImpl: impl }).createTemplate({ name: 'School' }),
    'internal',
  );
}

console.log('\n=== Templates: local form rules mirror Core ===\n');

check('an empty name is refused', templateNameRefusal('') !== null, true);
check('a padded name is refused, not trimmed', templateNameRefusal(' School ') !== null, true);
check('a trailing-space name is refused', templateNameRefusal('School ') !== null, true);
check('a plain name is accepted', templateNameRefusal('School'), null);
check('an 80-character name is accepted', templateNameRefusal('S'.repeat(80)), null);
check('an 81-character name is refused', templateNameRefusal('S'.repeat(81)) !== null, true);
// A blank label is valid input: it means "leave the default", and the client
// omits it rather than sending it.
check('a blank label is accepted locally (it means default)', templateLabelRefusal(''), null);
check('a padded label is refused', templateLabelRefusal(' Campus ') !== null, true);
check('a 40-character label is accepted', templateLabelRefusal('C'.repeat(40)), null);
check('a 41-character label is refused', templateLabelRefusal('C'.repeat(41)) !== null, true);

/* =========================================================================
   7. ONBOARDING — organization-onboarding-v1
   ========================================================================= */

console.log('\n=== Onboarding: the real shape ===\n');

const ONBOARD_BODY = {
  organization_id: 'og_synthetic_0000000009',
  admin_principal_id: 'pr_synthetic_0000000009',
  workspace_id: 'ws_synthetic_0000000009',
  warnings: [],
};

const onboarded = parseOnboardOrganization(ONBOARD_BODY);
check('organization_id', onboarded.organization_id, 'og_synthetic_0000000009');
check('admin_principal_id', onboarded.admin_principal_id, 'pr_synthetic_0000000009');
check('workspace_id', onboarded.workspace_id, 'ws_synthetic_0000000009');
check('warnings is empty on a clean success', onboarded.warnings.length, 0);

/*
 * THE PARTIAL SUCCESS. `workspace_id: null` with `first_workspace_not_created`
 * is a 201: the Organization, the admin and the credential all exist and the
 * tenant-side write did not. It must parse cleanly — a client that refused it
 * would discard the only copy of a real customer's credential.
 */
const partial = parseOnboardOrganization({
  ...ONBOARD_BODY,
  workspace_id: null,
  warnings: ['first_workspace_not_created'],
});
check('a null workspace_id parses (it is a success)', partial.workspace_id, null);
check('the warning is carried through', partial.warnings[0], 'first_workspace_not_created');
check('both warnings parse', parseOnboardOrganization({ ...ONBOARD_BODY, warnings: ONBOARDING_WARNINGS }).warnings.length, 2);

checkTrue('first_workspace_not_created is a known warning', isKnownOnboardingWarning('first_workspace_not_created'));
checkTrue('tenant_audit_record_not_written is a known warning', isKnownOnboardingWarning('tenant_audit_record_not_written'));
check('an invented warning is NOT claimed as known', isKnownOnboardingWarning('everything_is_fine'), false);
check(
  'an unrecognised warning still PARSES and is carried through verbatim',
  parseOnboardOrganization({ ...ONBOARD_BODY, warnings: ['something_newer'] }).warnings[0],
  'something_newer',
);

try {
  parseOnboardOrganization({ data: ONBOARD_BODY });
  failures += 1;
  console.log('FAIL  an ENVELOPED onboarding body is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  an ENVELOPED onboarding body is refused, not silently misread');
}
try {
  parseOnboardOrganization({ ...ONBOARD_BODY, warnings: undefined });
  failures += 1;
  console.log('FAIL  a missing warnings array is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  a missing warnings array is refused (absent is not empty)');
}

console.log('\n=== Onboarding: the request Core receives ===\n');

{
  const { impl, calls } = stubFetch(jsonResponse(ONBOARD_BODY, 201));
  await createPlatformClient({ fetchImpl: impl }).onboardOrganization({
    admin_identifier: 'admin@example.com',
    template_id: 'tp_synthetic_0000000001',
    derived_value: 'A'.repeat(43),
  });
  check('onboarding posts to /organizations', calls[0].url, '/api/v1/platform/organizations');
  check('onboarding is a POST', calls[0].init.method, 'POST');
  check('the session cookie is attached', calls[0].init.credentials, 'same-origin');

  const sent = JSON.parse(calls[0].init.body);
  const sentKeys = Object.keys(sent).sort();
  /*
   * EXACTLY THE FOUR DECLARED FIELDS. The class refuses any undeclared field
   * BEFORE AUTHENTICATION, and the absence of `role`/`permissions`/
   * `organization_id`/`principal_id`/`password` is `0025` decision 4 bound 3
   * rather than tidiness: there is no field through which an existing
   * Organization could be named.
   */
  check(
    'exactly the four declared fields are sent',
    sentKeys.join(','),
    'admin_identifier,derived_value,first_workspace_name,template_id',
  );
  for (const forbidden of ['role', 'permissions', 'memberships', 'password', 'organization_id', 'principal_id', 'workspace_id']) {
    check(`"${forbidden}" is NOT sent, not even empty`, forbidden in sent, false);
  }
  check('the password itself is never sent', JSON.stringify(sent).includes('password'), false);
  check(
    'first_workspace_name is the fixed placeholder',
    sent.first_workspace_name,
    DISCARDED_WORKSPACE_NAME_PLACEHOLDER,
  );
}

/*
 * THE PLACEHOLDER MUST SATISFY THE CONTRACT'S `workspaceName`: 1-120
 * characters, no leading or trailing whitespace. Core validates it and REFUSES
 * the whole request on a bad one — so a placeholder that failed validation would
 * make onboarding impossible while looking like a Core defect.
 */
console.log('\n=== Onboarding: the discarded placeholder is still valid input ===\n');
checkTrue('the placeholder is at least 1 character', DISCARDED_WORKSPACE_NAME_PLACEHOLDER.length >= 1);
checkTrue('the placeholder is at most 120 characters', DISCARDED_WORKSPACE_NAME_PLACEHOLDER.length <= 120);
check(
  'the placeholder has no leading or trailing whitespace',
  DISCARDED_WORKSPACE_NAME_PLACEHOLDER.trim(),
  DISCARDED_WORKSPACE_NAME_PLACEHOLDER,
);

/* -------------------------------------------------------------------------
   The generated password — THE REAL FUNCTION, not a copy
   ------------------------------------------------------------------------- */

console.log('\n=== Onboarding: the generated password ===\n');

const samples = Array.from({ length: 200 }, () => generateAdminPassword());

check('every password is exactly 32 characters', new Set(samples.map((s) => s.length)).size, 1);
check('and that length is 32', samples[0].length, GENERATED_PASSWORD_LENGTH);
check('32 characters is the documented length', GENERATED_PASSWORD_LENGTH, 32);
checkTrue(
  'every password is base64url with no padding',
  samples.every((s) => /^[A-Za-z0-9_-]{32}$/.test(s)),
);

/*
 * 200 SAMPLES, ALL DISTINCT. This does not prove the source is a CSPRNG — no
 * test can — but it fails immediately on the mistakes that actually happen: a
 * constant, a counter, a value derived from the clock, or a generator seeded
 * once per page load.
 */
check('200 generated passwords are all distinct', new Set(samples).size, 200);

/*
 * AND A CRUDE ENTROPY FLOOR. 200 samples of 32 characters is 6,400 characters
 * from a 64-symbol alphabet; a generator emitting a narrow range — the classic
 * symptom of a broken byte-to-character step — would show far fewer distinct
 * symbols. Deliberately loose: this is a smoke alarm, not a statistical test.
 */
const alphabet = new Set(samples.join(''));
checkTrue(
  `the alphabet is wide (${String(alphabet.size)} distinct characters of a possible 64)`,
  alphabet.size >= 60,
);

console.log('\n=== Onboarding: failures ===\n');

for (const [code, note] of [
  ['conflict', 'the admin identifier already has a credential'],
  ['not_found', 'the template_id names no Template'],
  ['quota_exceeded', 'Core created NOTHING'],
  ['invalid_argument', 'a field failed validation'],
]) {
  const { impl } = stubFetch(ENVELOPE(code, 'synthetic'));
  await checkThrows(
    `${code} is surfaced — ${note}`,
    () =>
      createPlatformClient({ fetchImpl: impl }).onboardOrganization({
        admin_identifier: 'admin@example.com',
        template_id: 'tp_synthetic_0000000001',
        derived_value: 'A'.repeat(43),
      }),
    code,
  );
}

{
  // A 201 whose body is not an onboarding result. It must NOT be reported as a
  // success — a credential panel drawn from an unreadable response would show a
  // password for an account nobody can name.
  const { impl } = stubFetch(jsonResponse({ ok: true }, 201));
  await checkThrows(
    'a 201 with an unreadable body is refused, never shown as created',
    () =>
      createPlatformClient({ fetchImpl: impl }).onboardOrganization({
        admin_identifier: 'admin@example.com',
        template_id: 'tp_synthetic_0000000001',
        derived_value: 'A'.repeat(43),
      }),
    'internal',
  );
}

/* =========================================================================
   8. ORGANIZATION DETAIL — organization-detail-v1
   ========================================================================= */

console.log('\n=== Organization detail: the real shape ===\n');

/*
 * `commercial_registration` AND `vat_registration` WERE ADDED TO THIS RESPONSE
 * ON 2026-09-07 by `organization-identity-v1`, and both are in `required`. They
 * are `not_recorded` here, which is the state every existing Organization is in
 * — "nobody has asked", which is a different fact from "they have none".
 */
const DETAIL_BODY = {
  organization_id: 'og_synthetic_0000000001',
  status: 'active',
  created_at: '2026-09-05T09:00:00Z',
  display_name: null,
  commercial_registration: { state: 'not_recorded' },
  vat_registration: { state: 'not_recorded' },
  template: {
    template_id: 'tp_synthetic_0000000001',
    name: 'School',
    level_labels: { organization: 'Group', workspace: 'Campus', branch: 'Classroom' },
  },
  member_count: 3,
};

const detail = parseOrganizationDetail(DETAIL_BODY);
check('organization_id', detail.organization_id, 'og_synthetic_0000000001');
check('display_name stays null', detail.display_name, null);
check('member_count is a number', detail.member_count, 3);
check('the embedded template name', detail.template?.name, 'School');
check('the embedded workspace label', detail.template?.level_labels.workspace, 'Campus');

check(
  'a null template parses (no Template recorded)',
  parseOrganizationDetail({ ...DETAIL_BODY, template: null }).template,
  null,
);
check('member_count of 0 parses', parseOrganizationDetail({ ...DETAIL_BODY, member_count: 0 }).member_count, 0);

/*
 * `template` IS REQUIRED AND NULLABLE, NOT OPTIONAL. An absent key is a contract
 * violation; reading it as null would hide the difference between "no Template
 * was recorded" and "this response is not the shape it claims".
 */
for (const [label, body] of [
  ['template ABSENT', (() => { const b = { ...DETAIL_BODY }; delete b.template; return b; })()],
  ['member_count absent', (() => { const b = { ...DETAIL_BODY }; delete b.member_count; return b; })()],
  ['member_count not an integer', { ...DETAIL_BODY, member_count: 2.5 }],
  ['member_count negative', { ...DETAIL_BODY, member_count: -1 }],
  ['member_count a string', { ...DETAIL_BODY, member_count: '3' }],
  ['an enveloped detail body', { data: DETAIL_BODY }],
  ['a template missing a level label', { ...DETAIL_BODY, template: { template_id: 'tp_x', name: 'S', level_labels: { organization: 'G', workspace: 'C' } } }],
  /*
   * BOTH REGISTRATIONS ARE REQUIRED. A response missing one is refused rather
   * than rendered as `not_recorded` — "nobody has asked" and "this response is
   * not the shape it claims" are different facts, and only one is safe to show
   * an operator about a customer.
   */
  ['commercial_registration ABSENT', (() => { const b = { ...DETAIL_BODY }; delete b.commercial_registration; return b; })()],
  ['vat_registration ABSENT', (() => { const b = { ...DETAIL_BODY }; delete b.vat_registration; return b; })()],
  ['a registration with no state', { ...DETAIL_BODY, vat_registration: {} }],
]) {
  try {
    parseOrganizationDetail(body);
    failures += 1;
    console.log(`FAIL  ${label} is refused\n        expected a throw, got none`);
  } catch {
    console.log(`PASS  ${label} is refused`);
  }
}

console.log('\n=== Organization detail: one request, no extra calls ===\n');

{
  const { impl, calls } = stubFetch(jsonResponse(DETAIL_BODY));
  await createPlatformClient({ fetchImpl: impl }).readOrganization('og_abc');
  check('read puts the id in the PATH', calls[0].url, '/api/v1/platform/organizations/og_abc');
  check('read is a GET', calls[0].init.method, 'GET');
  check('read sends no body', calls[0].init.body, undefined);
  /*
   * THE ONE-PAGE-ONE-REQUEST RULE. The Template is embedded, so rendering the
   * page must not fetch it. A read costs writes in this class and a three-request
   * page spends three times the budget.
   */
  check('rendering the page costs exactly ONE call', calls.length, 1);
}

{
  const { impl, calls } = stubFetch(jsonResponse(DETAIL_BODY));
  await createPlatformClient({ fetchImpl: impl }).readOrganization('a/b?c=d');
  check(
    'a hostile organization id is percent-encoded, not injected',
    calls[0].url,
    '/api/v1/platform/organizations/a%2Fb%3Fc%3Dd',
  );
}

console.log('\n=== The resolve: exactly one field, no confirmation ===\n');

const RESOLVE_BODY = { principal_id: 'pr_synthetic_0000000001', role: 'owner' };

const resolved = parseResolveMember(RESOLVE_BODY);
check('principal_id', resolved.principal_id, 'pr_synthetic_0000000001');
check('role', resolved.role, 'owner');
checkTrue('owner is a known role', isKnownMembershipRole('owner'));
checkTrue('member is a known role', isKnownMembershipRole('member'));
check('an invented role is NOT claimed as known', isKnownMembershipRole('admin'), false);

{
  const { impl, calls } = stubFetch(jsonResponse(RESOLVE_BODY));
  await createPlatformClient({ fetchImpl: impl }).resolveMember('og_abc', 'someone@example.com');
  check(
    'the Organization is a PATH parameter, not a body field',
    calls[0].url,
    '/api/v1/platform/organizations/og_abc/members/resolve',
  );
  check('resolve is a POST', calls[0].init.method, 'POST');
  const sent = JSON.parse(calls[0].init.body);
  /*
   * `resolveMemberInput` IS ONE FIELD WITH `additionalProperties: false`. A
   * confirmation token here would be a validation failure, not a courtesy — AND
   * gating the resolve would deadlock the credential reset, because the
   * principal_id this route returns is precisely what the reset's confirmation
   * must name.
   *
   * *** THE FIELD IS `target_identifier` SINCE 2026-09-07, AND `identifier` IS
   * NOW FORBIDDEN RATHER THAN MERELY UNUSED. *** `architecture.md` §1a: a bare
   * `identifier` is one word two contracts can each use correctly while meaning
   * different people — `confirmation-v1` injects `reauth_identifier`, the
   * CALLER'S own, into request shapes it does not own. This one is the
   * TARGET'S, so it says whose.
   *
   * SENDING BOTH IS REFUSED BY CORE with `must_not_send_both_names`, because if
   * the two values differ, choosing silently is choosing which principal to
   * resolve. The check below asserts the legacy name is absent, not merely that
   * the new one is present — those are different assertions and only the first
   * catches a body that carries both.
   */
  check('exactly one field is sent', Object.keys(sent).join(','), 'target_identifier');
  check('the value is the identifier the operator typed', sent.target_identifier, 'someone@example.com');
  /*
   * `identifier` IS IN THIS LIST DELIBERATELY. Phase 3 has Core and the
   * contract drop the legacy name in one change; until then Core accepts both,
   * so a client that sent both would be refused and a client that sent only the
   * old one would still work — which is exactly the state in which a
   * half-finished revert goes unnoticed.
   */
  for (const forbidden of ['identifier', 'confirmation', 'confirmation_token', 'organization_id', 'principal_id', 'role']) {
    check(`"${forbidden}" is NOT sent`, forbidden in sent, false);
  }
  /*
   * AN EXPLICIT NULL IS NOT AN OMITTED FIELD. Core's reading side had this
   * hazard — `target_identifier ?? identifier` treats an explicit null as
   * absent, so `{target_identifier: null, identifier: 'x'}` slips past a
   * both-present check and quietly resolves the legacy value. The client's
   * mirror image is a conditionally-built body; this asserts the value is a
   * real string, so a body that ever sent `null` turns red here.
   */
  check('and it is a string, never null', typeof sent.target_identifier, 'string');
  check('resolve costs exactly ONE call', calls.length, 1);
}

console.log('\n=== The resolve: the collapsed refusal ===\n');

/*
 * THE ANTI-ENUMERATION PROPERTY, ASSERTED FROM THE CLIENT SIDE.
 *
 * Core collapses five conditions into one argument-free 404. This client cannot
 * verify Core's half — but it CAN verify that it does not rebuild the oracle:
 * that every 404 produces one indistinguishable outcome no matter what the
 * envelope carries. A future edit that read `details` or `message` on this path
 * would fail here.
 */
const REFUSAL_ENVELOPES = [
  ['a bare 404', { error: { code: 'not_found', message: '', request_id: 'rq_1' } }],
  ['a 404 with a message', { error: { code: 'not_found', message: 'no such principal', request_id: 'rq_2' } }],
  [
    'a 404 carrying DETAILS that name the cause',
    {
      error: {
        code: 'not_found',
        message: 'x',
        request_id: 'rq_3',
        details: [{ field: 'target_identifier', issue: 'principal_is_platform_operator' }],
      },
    },
  ],
];

const refusalShapes = [];
for (const [label, envelope] of REFUSAL_ENVELOPES) {
  const { impl } = stubFetch(jsonResponse(envelope, 404));
  try {
    await createPlatformClient({ fetchImpl: impl }).resolveMember('og_abc', 'a@example.com');
    failures += 1;
    console.log(`FAIL  ${label} should reject`);
  } catch (thrown) {
    check(`${label} maps to not_found`, thrown.code, 'not_found');
    refusalShapes.push(thrown.code);
  }
}
check(
  'every refusal envelope produces the SAME code, whatever it carried',
  new Set(refusalShapes).size,
  1,
);

/*
 * AND THE SCREEN'S OWN GUARANTEE, ASSERTED AGAINST THE SOURCE.
 *
 * `OrganizationDetail.tsx` maps every `not_found` to `{ kind: 'refused' }`,
 * which carries NO payload — so nothing downstream can branch on the cause,
 * because nothing downstream has it. These are structural checks on the file
 * rather than on a value, because the property is "there is no code that could
 * do otherwise" and that is a claim about the source.
 */
console.log('\n=== The screen cannot rebuild the oracle ===\n');

const screen = readFileSync(
  join(import.meta.dirname, '..', 'src', 'screens', 'OrganizationDetail.tsx'),
  'utf8',
);
const screenCode = screen.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

checkTrue(
  "the refused state carries no payload (`kind: 'refused'` with no fields)",
  /\{\s*readonly kind:\s*'refused'\s*\}/.test(screen),
);
check(
  'there is exactly ONE refusal string constant',
  (screenCode.match(/\bconst REFUSAL\b/g) ?? []).length,
  1,
);
check(
  'the refusal string is referenced exactly once when rendering',
  (screenCode.match(/\{REFUSAL\}/g) ?? []).length,
  1,
);
check('the screen logs nothing at all', /console\s*\./.test(screenCode), false);
check(
  'the screen never reads `details` (which could name the cause)',
  /\.details\b/.test(screenCode),
  false,
);
/*
 * A REQUEST ID ON THE REFUSAL WOULD NOT LEAK THE CAUSE, BUT IT WOULD MAKE THE
 * FIVE CASES SEPARABLE BY ANYONE WHO CAN READ CORE'S LOGS — and it would give a
 * future author a value to branch on. `refused` carries no error, so this is
 * enforced by the type; the check states it so removing the type guarantee
 * cannot pass silently.
 */
check(
  "the refused branch has no error object to read a request id from",
  /kind:\s*'refused',\s*(error|request_id)/.test(screenCode),
  false,
);
checkTrue(
  'forbidden is a SEPARATE state from refused',
  /kind:\s*'forbidden'/.test(screenCode) && /kind:\s*'refused'/.test(screenCode),
);
/*
 * NO SPECULATIVE CALLS. Every resolve writes a tenant-side audit record into the
 * customer's own log, including refusals, so the call fires on submit and
 * nowhere else.
 */
check(
  'the resolve is not wired to typing (no onChange-triggered lookup)',
  /onChange[\s\S]{0,400}resolveMember/.test(screenCode),
  false,
);
check(
  'the detail read is not polled (no interval or focus listener)',
  /setInterval|addEventListener\(\s*['"](focus|visibilitychange|online)/.test(screenCode),
  false,
);

/* -------------------------------------------------------------------------
   THE LOCAL REFUSAL MUST NOT LOOK LIKE THE SERVER REFUSAL
   -------------------------------------------------------------------------
   Core's accepted identifier set is strictly LARGER than the set this console
   can submit: `normalizeIdentifier` is NFKC plus an ASCII-only case fold and
   NORMALISES non-ASCII rather than rejecting it, while this console refuses
   every code point outside 0x21-0x7E.

   So a lookup can fail because THE CONSOLE CANNOT TYPE THE ADDRESS, and to an
   operator that is indistinguishable from THE PERSON NOT EXISTING — unless the
   two are visibly different. Same-looking is correct for the five server cases
   and WRONG here, because this one is a statement about the console.

   The asymmetry itself is routed to architecture and is not fixed here. What is
   asserted here is that the console does not let the two collapse together.
   ------------------------------------------------------------------------- */

const nonAsciiSentinel = identifierRefusal(`${String.fromCharCode(0x00e9)}@example.com`);
checkTrue(
  'the shared check still refuses a non-ASCII identifier',
  typeof nonAsciiSentinel === 'string' && nonAsciiSentinel.length > 0,
);
checkTrue(
  'and its shared wording is about SIGNING IN, which is why this screen re-words it',
  /sign you in/.test(nonAsciiSentinel ?? ''),
);
checkTrue(
  'the screen derives that sentinel from the real function, not a copied literal',
  /NON_ASCII_SENTINEL\s*=\s*identifierRefusal\(/.test(screenCode),
);
checkTrue(
  'the screen substitutes its own non-ASCII wording',
  /NON_ASCII_LOOKUP_REFUSAL/.test(screenCode),
);
/*
 * Checked against `screenCode` — comments stripped — because the concern is a
 * hard-coded literal IN CODE, which would go stale when `platform/web` rewords
 * the shared sentence. Prose describing the situation is not the hazard.
 *
 * (The first version of this check scanned the raw source and failed on the
 * screen's own explanatory comment, which quoted the sentence. The comment now
 * paraphrases instead, so neither copy can go stale — but the check still reads
 * code, because that is what it is actually about.)
 */
check(
  'the shared sign-in wording is NOT hard-coded as a literal in the screen',
  screenCode.includes('sign you in'),
  false,
);

/*
 * The two texts must differ, and the local one must name the CONSOLE as the
 * limitation rather than making a claim about the member.
 */
const localRefusal = /const NON_ASCII_LOOKUP_REFUSAL\s*=\s*([\s\S]*?);\n/.exec(screen)?.[1] ?? '';
const serverRefusal = /const REFUSAL\s*=\s*([\s\S]*?);\n/.exec(screen)?.[1] ?? '';
checkTrue('both refusal texts were found in the source', localRefusal !== '' && serverRefusal !== '');
check('the local and server refusals are DIFFERENT strings', localRefusal === serverRefusal, false);
checkTrue(
  'the local refusal names the console as the limit',
  /this console|this screen/i.test(localRefusal),
);
checkTrue(
  'the local refusal disclaims any statement about the member',
  /says nothing about|nothing was looked up/i.test(localRefusal),
);
/*
 * AND THEY MUST NOT SHARE A RENDERING PATH. The local refusal goes into the
 * `Field`'s error slot — scarlet, iconed, attached to the input, above the
 * button. The server refusal renders in a neutral block below it. If a future
 * edit routed the local one through `{ kind: 'refused' }`, they would become
 * indistinguishable and this check is what would notice.
 */
check(
  'a local refusal never sets the server-refusal state',
  /setLocalError[\s\S]{0,200}kind:\s*'refused'/.test(screenCode),
  false,
);
checkTrue(
  'the local refusal is rendered through the field error slot',
  /error=\{localError\}/.test(screenCode),
);

/* =========================================================================
   9. THE AUDIT FEEDS — platform-audit-read-v1
   ========================================================================= */

console.log('\n=== The two feeds differ by exactly one field ===\n');

const COMMON = {
  record_id: 'rc_synthetic_0000000001',
  occurred_at: '2026-09-05T10:00:00Z',
  actor_principal_id: 'pr_synthetic_0000000001',
  actor_platform_role: 'platform-admin',
  action_id: 'platform.credentials.reset',
  outcome: 'succeeded',
  correlation_id: 'co_synthetic_0000000001',
};

const PLATFORM_RECORD = { ...COMMON, target_organization_id: 'og_synthetic_0000000001' };
const ORG_RECORD = { ...COMMON, target_principal_id: 'pr_synthetic_0000000002' };

const platformPage = parsePlatformFeed({ data: [PLATFORM_RECORD], next_cursor: null });
check('platform feed: data is top-level', platformPage.data.length, 1);
check('platform feed: the Organization target', platformPage.data[0].target_organization_id, 'og_synthetic_0000000001');
check('platform feed: a null Organization target parses', parsePlatformFeed({ data: [{ ...COMMON, target_organization_id: null }], next_cursor: null }).data[0].target_organization_id, null);

/*
 * THE ASSERTION THE WHOLE CONTRACT TURNS ON, FROM THE CLIENT SIDE. Even when
 * Core hands the platform parser a record that CARRIES `target_principal_id`,
 * the parsed value must not contain one — the field never enters the client's
 * memory, let alone its render tree.
 */
const smuggled = parsePlatformFeed({
  data: [{ ...PLATFORM_RECORD, target_principal_id: 'pr_should_never_appear' }],
  next_cursor: null,
});
check(
  'platform feed: a smuggled target_principal_id is NOT carried through',
  'target_principal_id' in smuggled.data[0],
  false,
);
check(
  'and it is nowhere in the serialised parsed page',
  JSON.stringify(smuggled).includes('pr_should_never_appear'),
  false,
);

const orgPage = parseOrganizationFeed({ data: [ORG_RECORD], next_cursor: null });
check('Organization feed: the principal target IS carried', orgPage.data[0].target_principal_id, 'pr_synthetic_0000000002');
check('Organization feed: a null principal target parses', parseOrganizationFeed({ data: [{ ...COMMON, target_principal_id: null }], next_cursor: null }).data[0].target_principal_id, null);
check(
  'Organization feed: no target_organization_id is carried (the path fixed it)',
  'target_organization_id' in orgPage.data[0],
  false,
);

for (const field of ['record_id', 'occurred_at', 'actor_principal_id', 'actor_platform_role', 'action_id', 'outcome', 'correlation_id']) {
  const body = { ...PLATFORM_RECORD };
  delete body[field];
  try {
    parsePlatformFeed({ data: [body], next_cursor: null });
    failures += 1;
    console.log(`FAIL  a record missing "${field}" is refused\n        expected a throw, got none`);
  } catch {
    console.log(`PASS  a record missing "${field}" is refused`);
  }
}

try {
  parsePlatformFeed({ data: [{ ...COMMON }], next_cursor: null });
  failures += 1;
  console.log('FAIL  a platform record missing target_organization_id is refused\n        expected a throw');
} catch {
  console.log('PASS  a platform record missing target_organization_id is refused (required, nullable)');
}
try {
  parseOrganizationFeed({ data: [{ ...COMMON }], next_cursor: null });
  failures += 1;
  console.log('FAIL  an Organization record missing target_principal_id is refused\n        expected a throw');
} catch {
  console.log('PASS  an Organization record missing target_principal_id is refused (required, nullable)');
}

console.log('\n=== The feeds: requests, filters and paging ===\n');

{
  const { impl, calls } = stubFetch(jsonResponse({ data: [], next_cursor: null }));
  await createPlatformClient({ fetchImpl: impl }).listPlatformAudit();
  check('platform feed path', calls[0].url, '/api/v1/platform/audit');
  check('it is a GET', calls[0].init.method, 'GET');
  check('no body', calls[0].init.body, undefined);
}

{
  const { impl, calls } = stubFetch(jsonResponse({ data: [], next_cursor: null }));
  await createPlatformClient({ fetchImpl: impl }).listPlatformAudit({
    pageSize: 25,
    filters: {
      actor_principal_id: 'pr_a',
      action_id: 'platform.audit.list',
      /*
       * DERIVED FROM THE HELPERS, NOT HAND-WRITTEN. These literals previously
       * read `2026-09-01T00:00:00Z` and `…T23:59:59.999Z` — copied by hand, and
       * the first was the exact defective form the screens were sending. A
       * fixture that hard-codes what it expects can pass while the code under
       * it sends something else, which is what happened here.
       */
      since: toUtcDayStart('2026-09-01'),
      until: toUtcExclusiveDayEnd('2026-09-05'),
    },
  });
  const url = calls[0].url;
  checkTrue('actor_principal_id IS sent on the platform feed', url.includes('actor_principal_id=pr_a'));
  checkTrue('action_id is sent', url.includes('action_id=platform.audit.list'));
  checkTrue(
    'since is sent with three fractional digits',
    url.includes(`since=${encodeURIComponent(toUtcDayStart('2026-09-01'))}`),
  );
  checkTrue(
    'until is the NEXT day at .000, not an inclusive end',
    url.includes(`until=${encodeURIComponent('2026-09-06T00:00:00.000Z')}`),
  );
  check('no target_principal_id parameter is ever sent', url.includes('target_principal_id'), false);
}

{
  const { impl, calls } = stubFetch(jsonResponse({ data: [], next_cursor: null }));
  await createPlatformClient({ fetchImpl: impl }).listOrganizationAudit('og_abc', {
    pageSize: 25,
    filters: { action_id: 'x' },
  });
  checkTrue(
    'Organization feed path includes the id and /audit',
    calls[0].url.startsWith('/api/v1/platform/organizations/og_abc/audit?'),
  );
  check('and no target_principal_id parameter', calls[0].url.includes('target_principal_id'), false);
  check('and no actor_principal_id parameter (not accepted here)', calls[0].url.includes('actor_principal_id'), false);
}

{
  const { impl, calls } = stubFetch(jsonResponse({ data: [], next_cursor: null }));
  await createPlatformClient({ fetchImpl: impl }).listOrganizationAudit('a/b', {});
  check(
    'a hostile organization id is percent-encoded',
    calls[0].url,
    '/api/v1/platform/organizations/a%2Fb/audit',
  );
}

{
  const { impl, calls } = stubFetch(jsonResponse({ data: [], next_cursor: null }));
  await createPlatformClient({ fetchImpl: impl }).listPlatformAudit({ pageSize: 25, cursor: null });
  check('a null cursor is omitted', calls[0].url, '/api/v1/platform/audit?page_size=25');
}

console.log('\n=== The UTC day helpers ===\n');

/*
 * THE FORMAT IS NOW SPECIFIED: RFC 3339 UTC with EXACTLY THREE fractional
 * digits, and the interval is HALF-OPEN `[since, until)`.
 *
 * THE WIDTH IS A CORRECTNESS RULE. Comparison against stored timestamps is
 * lexicographic, which equals temporal comparison only when both operands are
 * the same width: at index 19 a stored value has `.` (0x2E) and a bound with no
 * fractional part has `Z` (0x5A), and `.` sorts first. So a bound written
 * without milliseconds shifts FORWARD by up to a second —
 * `since=…T00:00:00Z` silently drops every record in second 00, which is what
 * this console was shipping.
 */

check('the day start carries .000', toUtcDayStart('2026-09-05'), '2026-09-05T00:00:00.000Z');
check(
  'the exclusive end is the NEXT day at .000',
  toUtcExclusiveDayEnd('2026-09-05'),
  '2026-09-06T00:00:00.000Z',
);

/* THE WIDTH RULE, ASSERTED ON THE OUTPUT RATHER THAN TRUSTED. */
for (const [label, value] of [
  ['start', toUtcDayStart('2026-09-05')],
  ['exclusive end', toUtcExclusiveDayEnd('2026-09-05')],
]) {
  checkTrue(
    `the ${label} has exactly three fractional digits`,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value ?? ''),
  );
  check(`the ${label} is 24 characters, the stored width`, (value ?? '').length, 24);
}

/*
 * THE HALF-OPEN INTERVAL COVERS THE WHOLE DAY AND NOTHING MORE. A record at the
 * first instant is included; one at the last is included; the next day's first
 * instant is not.
 */
{
  const since = new Date(toUtcDayStart('2026-09-05')).getTime();
  const until = new Date(toUtcExclusiveDayEnd('2026-09-05')).getTime();
  const at = (v) => new Date(v).getTime();
  checkTrue('the first instant of the day is included', at('2026-09-05T00:00:00.000Z') >= since);
  checkTrue('a record in second 00 is included', at('2026-09-05T00:00:00.500Z') >= since);
  checkTrue('the last instant of the day is included', at('2026-09-05T23:59:59.999Z') < until);
  checkTrue('the next day is excluded', at('2026-09-06T00:00:00.000Z') >= until);
  check('the window is exactly one day', until - since, 86_400_000);
}

/*
 * THE REGRESSIONS THIS REPLACED, ASSERTED SO THEY CANNOT RETURN SILENTLY.
 */
checkTrue(
  'the superseded T00:00:00Z sorts AFTER a record in second 00 (the shipped defect)',
  '2026-09-05T00:00:00Z' > '2026-09-05T00:00:00.500Z',
);
checkTrue(
  'and the superseded T23:59:59.999Z would exclude the final millisecond under a half-open end',
  !(at2('2026-09-05T23:59:59.999Z') < at2('2026-09-05T23:59:59.999Z')),
);
function at2(v) {
  return new Date(v).getTime();
}

/*
 * DAY, MONTH AND YEAR ROLLOVER — the exclusive end is the next day, so these are
 * the boundaries a hand-built string would get wrong.
 */
check('month rollover', toUtcExclusiveDayEnd('2026-09-30'), '2026-10-01T00:00:00.000Z');
check('year rollover', toUtcExclusiveDayEnd('2026-12-31'), '2027-01-01T00:00:00.000Z');
check('february in a non-leap year', toUtcExclusiveDayEnd('2026-02-28'), '2026-03-01T00:00:00.000Z');
check('february in a leap year', toUtcExclusiveDayEnd('2028-02-28'), '2028-02-29T00:00:00.000Z');
check('and the leap day itself', toUtcExclusiveDayEnd('2028-02-29'), '2028-03-01T00:00:00.000Z');

/*
 * A WELL-FORMED BUT NON-EXISTENT DATE IS REFUSED rather than normalised into a
 * range the operator did not ask for.
 */
check('a non-existent date is refused, not slid into March', toUtcDayStart('2026-02-31'), null);
check('and so is its exclusive end', toUtcExclusiveDayEnd('2026-02-31'), null);

/*
 * THE EQUAL-BOUNDS CASE. A zero-width half-open interval returns nothing, so a
 * single-day pick must not produce equal bounds. CONFIRMED HERE rather than
 * taken on assurance.
 */
{
  const since = toUtcDayStart('2026-09-05');
  const until = toUtcExclusiveDayEnd('2026-09-05');
  check('one date for both ends does NOT produce equal bounds', since === until, false);
  checkTrue('and they differ by exactly one day', new Date(until).getTime() - new Date(since).getTime() === 86_400_000);
}
check('an empty date yields null, so nothing is sent', toUtcDayStart(''), null);
check('a zoneless datetime is NOT accepted as a calendar date', toUtcDayStart('2026-09-05T10:00'), null);
check('a malformed date yields null', toUtcExclusiveDayEnd('05/09/2026'), null);
checkTrue(
  'every produced timestamp ends in Z',
  [toUtcDayStart('2026-01-01'), toUtcExclusiveDayEnd('2026-12-31')].every(
    (v) => v !== null && v.endsWith('Z'),
  ),
);

console.log('\n=== Operators: three fields and nothing else ===\n');

const OPERATOR = {
  principal_id: 'pr_synthetic_0000000001',
  platform_role: 'platform-admin',
  created_at: '2026-09-05T09:00:00Z',
};

const operators = parseListOperators({ data: [OPERATOR], next_cursor: null });
check('principal_id', operators.data[0].principal_id, 'pr_synthetic_0000000001');
check('platform_role', operators.data[0].platform_role, 'platform-admin');
check('created_at', operators.data[0].created_at, '2026-09-05T09:00:00Z');
check('an empty roster parses as a page, not an error', parseListOperators({ data: [], next_cursor: null }).data.length, 0);

/*
 * NO IDENTIFIER, NO EMAIL, NO DISPLAY NAME. `0001_principal.sql` refused an
 * email column because a directory of personal details readable without tenant
 * scope "would be the highest-value target in the system", and an operator
 * roster showing addresses would be that directory at the most privileged end.
 * If Core ever sent one, this parser must not carry it.
 */
const rosterSmuggled = parseListOperators({
  data: [{ ...OPERATOR, identifier: 'someone@example.com', display_name: 'Sam' }],
  next_cursor: null,
});
check(
  'a smuggled identifier is NOT carried through',
  JSON.stringify(rosterSmuggled).includes('someone@example.com'),
  false,
);
check('nor a display name', JSON.stringify(rosterSmuggled).includes('Sam'), false);

{
  const { impl, calls } = stubFetch(jsonResponse({ data: [], next_cursor: null }));
  await createPlatformClient({ fetchImpl: impl }).listOperators({ pageSize: 25 });
  check('operators path', calls[0].url, '/api/v1/platform/operators?page_size=25');
  check('it is a GET', calls[0].init.method, 'GET');
}

checkTrue('platform-admin is a known role', isKnownPlatformRole('platform-admin'));
checkTrue('marketplace-moderator is a known role', isKnownPlatformRole('marketplace-moderator'));
check('an invented role is not claimed as known', isKnownPlatformRole('root'), false);
checkTrue('succeeded is a known outcome', isKnownAuditOutcome('succeeded'));
checkTrue('failed is a known outcome', isKnownAuditOutcome('failed'));
check('an invented outcome is not claimed as known', isKnownAuditOutcome('partial'), false);

/* =========================================================================
   10. STRUCTURAL — the screens cannot undo the contract's properties
   ========================================================================= */

console.log('\n=== The screens: structural guarantees ===\n');

const readScreen = (name) =>
  readFileSync(join(import.meta.dirname, '..', 'src', 'screens', name), 'utf8');

const platformScreen = strip(readScreen('PlatformAudit.tsx'));
const orgAuditScreen = strip(readScreen('OrganizationAudit.tsx'));
const operatorsScreen = strip(readScreen('Operators.tsx'));
/*
 * The server-state layer, read once here rather than twice further down. It is
 * declared BEFORE its first use deliberately: a `const` referenced above its
 * declaration is a temporal-dead-zone `ReferenceError` at run time, not a
 * compile error — the same failure mode that produced a blank admin console
 * when `route-tree` and `root-layout` formed a cycle.
 */
const queriesSource = strip(
  readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'queries.ts'), 'utf8'),
);
const auditList = strip(
  readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'AuditRecordList.tsx'), 'utf8'),
);

check(
  'the platform screen never mentions target_principal_id',
  /target_principal_id/.test(platformScreen),
  false,
);
/*
 * THE SHARED LIST COMPONENT MUST NOT KNOW EITHER TARGET FIELD. It receives
 * `AuditRecordCommon` plus a caller-supplied callback, so it cannot reach a
 * field its caller did not hand it — that is what keeps one component from
 * becoming the `if` the two routes exist to avoid.
 */
check('the shared list never names target_principal_id', /target_principal_id/.test(auditList), false);
check('the shared list never names target_organization_id', /target_organization_id/.test(auditList), false);
checkTrue('the shared list takes a renderTarget callback', /renderTarget/.test(auditList));

/* No polling anywhere on the audited screens. */
for (const [label, source] of [
  ['platform audit', platformScreen],
  ['Organization audit', orgAuditScreen],
  ['operators', operatorsScreen],
]) {
  check(
    `${label}: no interval or focus/reconnect refetch`,
    /setInterval|addEventListener\(\s*['"](focus|visibilitychange|online)/.test(source),
    false,
  );
}

/*
 * THE ORGANIZATION FEED MUST NOT FETCH ON MOUNT. Opening it spends five writes
 * from a customer's daily allowance, so arriving at the address — or landing
 * there from a mistyped link — must cost them nothing.
 */
/*
 * ===========================================================================
 * THIS CHECK USED TO GREP FOR `if (nonce === 0) return` AND WENT RED ON A
 * CORRECT CHANGE. REWRITTEN 2026-09-09 TO ASSERT THE PROPERTY.
 * ===========================================================================
 *
 * `workflow.md` §11a: a check that holds a name of its own goes stale when the
 * name moves — **it had transcribed the IMPLEMENTATION rather than asserting
 * the GUARANTEE.** The screen now reads through a mutation, which cannot fire
 * until it is called, and the old regex could not see that this is strictly
 * stronger than the guard it was looking for.
 *
 * **The property has two halves and BOTH are asserted, because either alone is
 * satisfiable by something that fetches on mount:**
 *
 *   1. the screen runs NO EFFECT — an effect is the only thing that can start
 *      work because a component mounted;
 *   2. it consumes NONE of the auto-fetching query hooks, and that set is
 *      DERIVED from `lib/queries.ts` rather than listed here, so a hook added
 *      later is covered without anyone remembering to add it.
 *
 * A screen with no effect that called `useOrganizationList` would still fetch
 * on arrival; a screen using the mutation but keeping an effect could still
 * fire from one. Neither half is redundant.
 */
const autoFetchingHooks = [
  ...queriesSource.matchAll(
    /export function (use\w+)[\s\S]{0,400}?return (useQuery|useMutation)</gu,
  ),
]
  .filter((match) => match[2] === 'useQuery')
  .map((match) => match[1]);

console.log(
  `  … ${String(autoFetchingHooks.length)} auto-fetching hook(s) derived from lib/queries.ts: ${autoFetchingHooks.join(', ')}`,
);
/*
 * A FLOOR. If the pattern above stops matching, the list is empty, "no
 * forbidden hook appears" passes vacuously, and the check reports success
 * having examined nothing (`workflow.md` §11a).
 */
checkTrue('the auto-fetching hook set is not empty', autoFetchingHooks.length >= 5);

checkTrue(
  'the Organization feed runs no effect that could fetch on mount',
  !/useEffect\s*\(/.test(orgAuditScreen),
);
check(
  'the Organization feed consumes no auto-fetching query hook',
  autoFetchingHooks.filter((hook) => new RegExp(`\\b${hook}\\s*\\(`, 'u').test(orgAuditScreen)).join(','),
  '',
);
checkTrue(
  'and its read is a mutation, which cannot fire until it is called',
  /export function useOrganizationAuditRead\(\)[\s\S]{0,900}?return useMutation</.test(
    queriesSource,
  ),
);
check(
  'the Organization feed offers no actor filter',
  /actor_principal_id/.test(orgAuditScreen),
  false,
);

/*
 * ===========================================================================
 * THE DETAIL SCREEN DISTINGUISHES `not_found` FROM `forbidden`, AND THAT
 * PERMISSION DOES NOT TRAVEL
 * ===========================================================================
 *
 * `platform.organizations.read`'s own `notFound` block licenses saying plainly
 * that an Organization does not exist: *"THERE IS NO ORACLE CONCERN HERE...
 * every caller who can reach this route can already enumerate every
 * Organization from platform.organizations.list."*
 *
 * **AND IT BOUNDS ITSELF IN THE SAME SENTENCE:** *"THIS REASONING IS SPECIFIC
 * TO THIS CLASS and must not be copied to a route reachable by a tenant
 * principal."*
 *
 * **So there are two things to assert and the second is the one that will
 * decay.** The first — that the console does distinguish them — is visible the
 * moment anyone opens the screen. The second — that no tenant-facing surface
 * copies the pattern — is invisible from inside this package and is exactly
 * what a shared component would quietly undo.
 *
 * **Scoped to the TREE, not to the paths that exist today** (`§2b`): a
 * path-scoped version is correct now and silently wrong the first time a
 * component lands somewhere else.
 */
{
  const detail = strip(readScreen('OrganizationDetail.tsx'));
  checkTrue(
    'the detail screen renders not_found as its own state',
    /error\.code === 'not_found'/.test(detail),
  );
  checkTrue(
    'and forbidden as a different one',
    /error\.code === 'forbidden'/.test(detail),
  );
  /*
   * NO RETRY ON A SETTLED ANSWER. `isRetryable` already refuses `not_found`, so
   * this asserts the screen does not route it through a control of its own —
   * two layers, and the outer one is where a future "helpful" retry would land.
   */
  /*
   * THE WINDOW IS 1200 CHARACTERS AND WAS 2000, TIGHTENED AFTER A NEGATIVE
   * CONTROL SHOWED HOW LOOSE IT WAS. The screen carries a SECOND
   * `to="/organizations"` — the back-link at the top — and a window wide enough
   * to reach an unrelated link is a window that would keep passing after the
   * panel's own link was deleted. The branch and its link are 18 lines apart.
   */
  checkTrue(
    'not_found offers a way back rather than a retry',
    /error\.code === 'not_found'[\s\S]{0,1200}to="\/organizations"/.test(detail),
  );

  /*
   * =======================================================================
   * AND THE TWO STATES MUST STILL *SAY* DIFFERENT THINGS, IN BOTH LANGUAGES
   * =======================================================================
   *
   * The three assertions above are structural — they prove the screen has two
   * BRANCHES. **They say nothing about what those branches render**, and after
   * the copy pass that is a dictionary question.
   *
   * **A `forbidden` body shortened to "not found" tells an operator a customer
   * does not exist when the truth is that they may not look** — a false
   * statement about a business, manufactured by a shorter sentence, with two
   * correct branches still rendering it. The same shape applies to the member
   * lookup: *refused* is not *found nothing*, and the second is a claim about a
   * person that nobody made.
   *
   * `Record<MessageKey, string>` proves an Arabic value EXISTS. It cannot prove
   * the value still distinguishes, so both halves are pinned.
   */
  const detailBodies = [
    ['detail.forbidden.body', /not the same as the Organization being missing/u, /يختلف عن كون المنشأة غير موجودة/u],
    ['detail.lookup.forbidden.body', /not the same as finding nothing/u, /يختلف عن ألّا يُعثر على شيء/u],
  ];
  for (const [key, english, arabic] of detailBodies) {
    const entries = [
      ...i18nSource.matchAll(
        new RegExp(`'${key.replace(/\./gu, '\\.')}':\\s*\\n?\\s*'([^']*)'`, 'gu'),
      ),
    ].map((match) => match[1]);
    check(`${key} is declared in both dictionaries`, entries.length, 2);
    checkTrue(
      `${key} says in ENGLISH that a refusal is not an absence`,
      entries.some((value) => english.test(value)),
    );
    checkTrue(
      `${key} says it in ARABIC too`,
      entries.some((value) => arabic.test(value)),
    );
  }

  /*
   * THE RESERVATION. `platform/web` is the tenant-facing administration; it must
   * not acquire this pattern. Asserted as an ABSENCE over the whole tree, so it
   * goes red the day a component carries it across rather than when someone
   * remembers to look.
   */
  const webRoot = join(import.meta.dirname, '..', '..', 'web', 'src');
  const webFiles = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) webFiles.push(path);
    }
  };
  walk(webRoot);
  console.log(`  … ${String(webFiles.length)} file(s) scanned in platform/web for the pattern`);
  /* A floor: a walk that reached nothing would report "no leak" perfectly. */
  checkTrue('the tenant-facing tree was actually walked', webFiles.length >= 20);
  check(
    'platform/web does NOT distinguish absent from not-yours (it would be an oracle there)',
    webFiles
      .filter((path) => {
        const source = strip(readFileSync(path, 'utf8'));
        return /code === 'not_found'/.test(source) && /does not exist/i.test(source);
      })
      .map((path) => path.slice(webRoot.length + 1))
      .join(','),
    '',
  );
}

/* The two ceilings must be rendered as different statements. */
const ceiling = strip(
  readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'CeilingNotice.tsx'), 'utf8'),
);
checkTrue('the ceiling notice distinguishes the two codes', /rate_limited/.test(ceiling) && /quota_exceeded/.test(ceiling));
checkTrue('and branches its wording on which one', /isRateLimit/.test(ceiling));
check(
  'quota_exceeded is not given an automatic retry',
  /onRetry\s*&&\s*!isRateLimit/.test(ceiling),
  false,
);

/*
 * REVOKE, AND THE CONSTRAINT THAT REPLACED "IT DOES NOT EXIST".
 *
 * These two checks previously asserted that no screen called revoke and that the
 * client exposed no method for it — correct while the confirmation flow was
 * unbuilt and the Team Lead had ruled it out of scope. **That ruling was
 * withdrawn when the flow was commissioned**, so asserting the old constraint
 * would have been `workflow.md` §12's exact shape: a test enforcing a decision
 * that no longer holds, which the natural fix makes pass by removing the
 * feature.
 *
 * WHAT IS ASSERTED INSTEAD IS THE CONSTRAINT THAT SURVIVED: revoke exists, and
 * it is reachable ONLY through the confirmation gate. A direct call — one that
 * did not carry the three fields — is what the old rule was really protecting
 * against.
 */
checkTrue(
  'the audit screens still make no revoke call',
  ![platformScreen, orgAuditScreen].some((source) =>
    /revokeOperator|\/revoke/.test(source),
  ),
);
checkTrue('the operators screen uses the confirmation gate', /ConfirmationGate/.test(operatorsScreen));
/*
 * EXACTLY ONE CALL SITE, and the next checks pin where it is. Counting rather
 * than forbidding: the call reached from the gate's `submit` handler is the
 * correct one, so a check that banned the identifier outright — as the first
 * version of this did — would have failed on the right implementation.
 *
 * ===========================================================================
 * THE CALL SITE MOVED WHEN THE SCREEN MOVED TO TANSTACK QUERY, AND THE
 * POPULATION IS WIDENED RATHER THAN THE ASSERTION RELAXED
 * ===========================================================================
 *
 * `Operators.tsx` used to call `platform.revokeOperator(...)` inside the gate's
 * `submit`. It now calls `revoke.mutateAsync(...)`, and the client method is
 * reached once, from `useRevokeOperator`'s `mutationFn` in `lib/queries.ts`.
 *
 * **The property being protected is unchanged: revoke is reachable only through
 * the confirmation gate, carrying the three fields.** So rather than pointing
 * the old regex at the new file, the count is taken over EVERY screen — the two
 * audit screens above were the only ones previously checked for absence — and
 * the single permitted site is pinned to the hook.
 */
const screenNames = readdirSync(join(import.meta.dirname, '..', 'src', 'screens'))
  .filter((name) => name.endsWith('.tsx'))
  .sort();
/*
 * The population, printed against an independently derived total, because
 * "0 screens call revoke" and "0 screens were read" render identically
 * (`workflow.md` §11a). The floor is the screens that exist on disk today; a
 * glob that stopped matching would take this to zero and fail here rather than
 * pass quietly downstream.
 */
console.log(`  … ${String(screenNames.length)} screen(s) examined: ${screenNames.join(', ')}`);
checkTrue('the screen population is not empty', screenNames.length >= 9);

const revokeCallsInScreens = screenNames.flatMap((name) => {
  const matches = strip(readScreen(name)).match(/revokeOperator\(/g) ?? [];
  return matches.map(() => name);
});
check(
  'no screen calls the revoke client method directly',
  revokeCallsInScreens.join(','),
  '',
);

check(
  'revoke has exactly one call site',
  (queriesSource.match(/revokeOperator\(/g) ?? []).length,
  1,
);
checkTrue(
  'and that call site is the revoke mutation, not a loose helper',
  /useRevokeOperator\(\)[\s\S]{0,600}mutationFn:[\s\S]{0,200}platformClient\.revokeOperator\(/.test(
    queriesSource,
  ),
);
/*
 * The mutation is what re-reads the roster, so a revoke cannot succeed and
 * leave a revoked operator on screen. It was a `nonce` bump in the component
 * before; asserting it here is what stops the invalidation being dropped as
 * "nothing reads this".
 */
checkTrue(
  'a successful revoke invalidates the operator roster',
  /useRevokeOperator\(\)[\s\S]{0,900}onSuccess:[\s\S]{0,200}invalidateQueries\([\s\S]{0,120}queryKeys\.operators/.test(
    queriesSource,
  ),
);
checkTrue(
  'revoke is submitted from inside the gate, carrying a confirmation',
  /submit=\{[\s\S]{0,400}mutateAsync\([\s\S]{0,300}\.\.\.confirmation/.test(operatorsScreen),
);
/*
 * ONE SCREEN MAY REVOKE, AND IT IS THE ONE WITH THE GATE. `ConfirmedSubmission`
 * already makes a gateless call fail to compile — it demands the three fields —
 * but the type says nothing about where they came from, and a screen could
 * assemble them itself. This says which file is allowed to hold the mutation.
 */
check(
  'only the operators screen holds the revoke mutation',
  screenNames.filter((name) => /useRevokeOperator\(/.test(strip(readScreen(name)))).join(','),
  'Operators.tsx',
);

/* =========================================================================
   10b. TEMPLATE LIFECYCLE — the properties the contract spent pages on
   ========================================================================= */

console.log('\n=== Template lifecycle: transitions are routes, not a field ===\n');

{
  const platformApi = strip(
    readFileSync(join(import.meta.dirname, '..', 'src', 'api', 'platform.ts'), 'utf8'),
  );
  const templatesScreen = strip(readScreen('Templates.tsx'));
  const detailScreen = strip(readScreen('OrganizationDetail.tsx'));

  /*
   * ===========================================================================
   * NO REQUEST ANYWHERE MAY CARRY A LIFECYCLE STATUS
   * ===========================================================================
   *
   * `template-lifecycle-v1` gives three reasons and the third decides it: a
   * status a client SENDS is a request enum and must be `closed` (`0041`
   * amendment 1), while the same words read back are `extensible` — one value
   * set, two policies. **A transition named by a route needs no vocabulary.**
   *
   * The first reason is the security one: **a `status` in a PATCH body would
   * let `core.template.update` perform `core.template.retire`'s act** — the
   * permission split undone by a field. That is what this asserts.
   */
  /*
   * ⚠ THE FIRST VERSION MATCHED ONLY `status: 'retired'` — THE OBJECT-LITERAL
   * FORM — AND ITS CONTROL REPORTED BLIND.
   *
   * The realistic mutation is `body.status = 'retired'`, an ASSIGNMENT, because
   * that is how this client actually builds a request body. **I wrote the
   * pattern from the shape I had in mind rather than from the shape the code
   * takes** — the second time today, and the same mechanism as the absence
   * check that could not see `not … yet`.
   *
   * `[:=](?!=)` accepts both forms and still refuses `status === 'active'`,
   * which is a legitimate COMPARISON this file makes in `isKnownTemplateStatus`
   * — verified against all four shapes rather than assumed.
   */
  check(
    'no client method sends a template status',
    /setTemplateStatus|\bstatus\b\s*[:=](?!=)\s*['"](active|retired)['"]/.test(platformApi),
    false,
  );
  checkTrue(
    'retire and restore are separate client methods',
    /async retireTemplate\(/.test(platformApi) && /async restoreTemplate\(/.test(platformApi),
  );
  /*
   * AND SEPARATE HOOKS. A single `useSetTemplateStatus(id, direction)` would
   * type-check and re-merge the split one layer above the transport — which is
   * exactly where a reviewer reading the contract would not look for it.
   */
  checkTrue(
    'and separate hooks, so the split is not re-merged above the transport',
    /export function useRetireTemplate\(/.test(queriesSource) &&
      /export function useRestoreTemplate\(/.test(queriesSource),
  );
  check(
    'no hook takes a transition direction as an argument',
    /useSetTemplateStatus|useToggleTemplate/.test(queriesSource),
    false,
  );

  /*
   * ===========================================================================
   * SR-14: THE CENSUS IS READ FROM ITS OWN ROUTE, AND FROM NOWHERE ELSE
   * ===========================================================================
   *
   * `organizations_using` was returned by `update`, `retire` and `restore` —
   * making an adoption count reachable through `core.template.update` and
   * `core.template.retire`, **neither of which is the permission created to
   * gate a census** (`security.md` §2a).
   *
   * **The display side is already guaranteed by a TYPE**: `UsageLine` takes
   * `ReturnType<typeof useTemplateUsage>`, so it cannot be handed a mutation
   * result. This asserts the other half — that the field is not read out of a
   * write response on the way to somewhere else.
   *
   * **The count must appear exactly ONCE outside comments**: in
   * `parseTemplateUsage`, which serves `platform.templates.usage` alone.
   *
   * ---------------------------------------------------------------------------
   * ✅ SR-14 LANDED 2026-09-11, AND THIS CONTROL NOW FAILS FOR TWO INDEPENDENT
   *    REASONS RATHER THAN ONE
   * ---------------------------------------------------------------------------
   *
   * `core-agent` confirmed by response keys that `update`, `retire` and
   * `restore` return the bare Template — **and went further than the contract
   * required by removing the port whose only use was computing the census.**
   *
   * So a client that tried to surface an adoption count off a write response
   * would fail because **the field is gone from the response AND the handler
   * cannot compute it.** The second is the durable half: a handler that CAN
   * compute a census and merely does not is one edit away from disclosing it,
   * and re-adding the port is a visible change to the composition.
   *
   * **The assertion below is therefore a RESERVATION rather than a shape
   * check.** The transition shim is deleted; the name may not come back, in
   * either transition parser or anywhere else in the client.
   */
  const censusReads = [...platformApi.matchAll(/organizations_using/gu)].length;
  console.log(`  … "organizations_using" appears ${String(censusReads)} time(s) in the client`);
  checkTrue(
    'the census is parsed in exactly one place',
    /export function parseTemplateUsage\(/.test(platformApi),
  );
  check(
    'and the transition shim is GONE, not left standing as harmless',
    /parseTemplateFromTransition/.test(platformApi),
    false,
  );
  checkTrue(
    'retire parses the bare Template directly',
    /return parseTemplate\(\s*await platformRequest\(\s*`\$\{TEMPLATES_PATH\}\/\$\{encodeURIComponent\(templateId\)\}\/retire`/.test(
      platformApi,
    ),
  );
  checkTrue(
    'and so does restore',
    /return parseTemplate\(\s*await platformRequest\(\s*`\$\{TEMPLATES_PATH\}\/\$\{encodeURIComponent\(templateId\)\}\/restore`/.test(
      platformApi,
    ),
  );
  check(
    'no screen reads a count off a mutation result',
    /(retire|restore|update)\.(mutate|mutateAsync)[\s\S]{0,300}organizations_using/.test(
      templatesScreen,
    ),
    false,
  );

  /*
   * ===========================================================================
   * AND THE TRANSITION RESPONSE IS EXERCISED, NOT ASSERTED ABOUT — INCLUDING
   * THE SHAPE THAT MUST NOW BE REFUSED
   * ===========================================================================
   *
   * The checks above are regexes over source — they prove a call site READS a
   * certain way. **They do not prove the shape parses.**
   *
   * **The second case is the reason the shim was deleted rather than left in
   * place.** A parser that accepts two shapes forever cannot tell a correct
   * response from a stale deployment — so the wrapped shape, which is what
   * Core sent until this morning, must now be REFUSED. That refusal is the
   * property the deletion bought; without it the deletion is only tidying.
   */
  const bareTemplate = {
    template_id: 'tpl_1',
    name: 'School',
    level_labels: { organization: 'Group', workspace: 'Campus', branch: 'Wing' },
    status: 'retired',
    created_at: '2026-09-11T00:00:00.000Z',
  };
  check(
    'a transition response parses as the BARE Template Core now sends',
    parseTemplate(bareTemplate, 'bare').template_id,
    'tpl_1',
  );
  check(
    'and the census cannot ride along on it',
    Object.keys(parseTemplate(bareTemplate, 'bare')).includes('organizations_using'),
    false,
  );
  let wrappedRefused = false;
  try {
    parseTemplate({ template: bareTemplate, organizations_using: 3 }, 'wrapped');
  } catch {
    wrappedRefused = true;
  }
  checkTrue(
    'and the WRAPPED shape Core sent until SR-14 is now refused, not tolerated',
    wrappedRefused,
  );

  /*
   * =========================================================================
   * ⚠ EVERY MUTATION ON THIS SURFACE MUST RENDER ITS OWN FAILURE
   * =========================================================================
   *
   * **`restore.error` was rendered NOWHERE.** `retire.error` lives inside the
   * retire panel and `update.error` inside the edit panel; restore is a
   * one-press action with no panel, so its failure had no home. The button
   * un-busied, the Template stayed retired, and **no sentence appeared
   * anywhere.**
   *
   * **A MISSING STATE RENDERS AS NOTHING, AND NOTHING IS WHAT A SUCCESSFUL
   * NO-OP LOOKS LIKE TOO** — which is why no check and no test could have
   * noticed. It was found by walking the six state families across the Template
   * surfaces and asking which cell was empty.
   *
   * **And the cost lands on the customer's ledger**: an operator who sees a
   * control they pressed, a Template that did not change and no reason will
   * press it again, spending another audited write to be refused identically.
   *
   * Derived from the hooks the screen HOLDS rather than a list written here, so
   * a fourth lifecycle mutation cannot be added without appearing.
   */
  {
    const mutations = [
      ...new Set(
        [...templatesScreen.matchAll(/const (\w+) = use(Retire|Restore|Update|Create)Template\(/gu)].map(
          (match) => match[1],
        ),
      ),
    ];
    console.log(`  … ${String(mutations.length)} Template mutation hook(s) held by the screen`);
    /* A floor: zero derived hooks would assert perfect coverage over nothing. */
    checkTrue('the mutation scan found the hooks', mutations.length >= 3);
    /*
     * ⚠ THE FIRST VERSION FLAGGED `createTemplate` AND THE SCREEN WAS FINE.
     *
     * It tested `X.error !== null` — **one IMPLEMENTATION of the property, not
     * the property.** `createTemplate` renders its failure the other legitimate
     * way: `onError` on the `.mutate` call, into local state, rendered as
     * `{failure ? …}`. Verified by reading the call site before widening
     * anything (`§11a`).
     *
     * **The check earned its keep anyway** — it is the reason I read that call
     * site at all, and it is how `restore` was found genuinely silent.
     *
     * **THE LIMIT, STATED: the second branch is weaker than the first.** Reading
     * `X.error` proves the failure reaches the render; an `onError` proves only
     * that a handler exists. **A handler that swallows the error would pass
     * this**, and no regex over one file can tell the difference. Two patterns
     * for one property is itself a small hazard, and it is named here rather
     * than hidden by a check that accepts both silently.
     */
    const silent = mutations.filter(
      (name) =>
        !new RegExp(`${name}\\.error !== null`, 'u').test(templatesScreen) &&
        !new RegExp(`${name}\\.mutate\\(`, 'u').test(templatesScreen),
    );
    check('every Template mutation renders its own failure', silent.join(', '), '');
    /*
     * AND EACH KEEPS THE forbidden-VS-OTHER SPLIT. A refusal is a permission
     * boundary and gets no retry; collapsing the two would put a Try again
     * beside a door that is closed on purpose.
     */
    const collapsed = mutations.filter(
      (name) =>
        new RegExp(`${name}\\.error !== null`, 'u').test(templatesScreen) &&
        !new RegExp(`${name}\\.error\\.code === 'forbidden'`, 'u').test(templatesScreen),
    );
    check('and distinguishes a refusal from a failure', collapsed.join(', '), '');
    /*
     * AND THE THREE THAT READ `.error` DIRECTLY ARE NAMED, so the weaker
     * `onError` branch above cannot quietly become the majority. If this drops,
     * a mutation has moved to the pattern this check cannot fully verify.
     */
    check(
      'three of the four read the hook error directly',
      mutations.filter((name) =>
        new RegExp(`${name}\\.error !== null`, 'u').test(templatesScreen),
      ).length,
      3,
    );
  }

  /*
   * THE RETIRE DECISION IS NOT MADE BLIND. The usage route exists because the
   * Team Lead ruled it ships WITH retire rather than after it — *"the read an
   * operator performs BEFORE retiring."* A retire control that acts without
   * showing `organizations_using` re-opens the finding that created the route.
   */
  checkTrue(
    'the retire panel reads usage before offering the act',
    /panel === 'retire'[\s\S]{0,900}usage\.heading/.test(templatesScreen),
  );
  checkTrue(
    'and the usage query is enabled only while that panel is open',
    /useTemplateUsage\(panel === 'retire' \? template\.template_id : null\)/.test(templatesScreen),
  );
  /*
   * THE FACT THAT DECIDES THE ANSWER. Retiring does NOT free the unique name —
   * which is the whole reason `restore` exists. A confirmation omitting it asks
   * an operator to agree to something they were not told.
   */
  checkTrue(
    'the retire copy states that the name stays taken',
    /'retire\.namePoint'/.test(templatesScreen),
  );

  /*
   * CLEARING IS AN OPERATION. `{ template_id: null }` must be SENT; omitting
   * the field is an empty patch that changes nothing, where the operator meant
   * "adopt none".
   */
  checkTrue(
    'clearing an Organization template sends an explicit null',
    /body: \{ template_id: input\.template_id \}/.test(platformApi),
  );
  checkTrue(
    'and the screen can express the cleared choice',
    /chosen === '' \? null : chosen/.test(detailScreen),
  );

  /*
   * ===========================================================================
   * THE CURRENT TEMPLATE IS ALWAYS REPRESENTABLE IN THE PICKER
   * ===========================================================================
   *
   * **Retire is not delete, so an Organization can be ON a retired Template** —
   * which is why the picker is not filtered (Team Lead ruling, 2026-09-11).
   * The same fact has a second consequence that arrives through PAGINATION
   * rather than through a filter:
   *
   * The picker takes ONE page. **If the current Template is not on it, the
   * `<select>` has no matching option and a browser renders the FIRST one** —
   * "None recorded" against an Organization that has one, and Save then sends
   * `null`. **A silent reset of exactly the value the screen exists to change.**
   *
   * `templateOptions` appends the current entry when the page lacks it.
   */
  checkTrue(
    'the picker guarantees the current Template is an option',
    /function templateOptions\(/.test(detailScreen) &&
      /templateOptions\(picker\.data\?\.data \?\? \[\], current\)/.test(detailScreen),
  );
  /*
   * AND IT INVENTS NO STATUS FOR IT. `organization-detail-v1`'s embedded
   * template carries no `status`, so the appended option has none — defaulting
   * it to `'active'` would assert a lifecycle state the response never sent,
   * and would be wrong in the hiding direction on a retired Template.
   */
  check(
    'and invents no status for the appended entry',
    /template_id: current\.template_id, name: current\.name, status:/.test(detailScreen),
    false,
  );

  /*
   * NO INVENTED CONFIRMATION GATE. `template-lifecycle-v1` declares
   * `requiresConfirmation` on NONE of these routes — they are audited, not
   * gated. `OrganizationIdentity` records the rule: this console must not
   * invent a gate the ladder did not put there, because making a `sensitive`
   * act `critical` generalises to every field and the rung stops sorting.
   */
  check(
    'no confirmation gate is invented for the lifecycle routes',
    /ConfirmationGate/.test(templatesScreen),
    false,
  );

  /*
   * ===========================================================================
   * FOCUS MOVES IN **AND COMES BACK** ON EVERY PANEL THAT REPLACES ITS OPENER
   * ===========================================================================
   *
   * **The return half is asserted separately because it is the half that gets
   * dropped**, and it is dropped for a specific reason: **nothing looks wrong
   * without it.** A sighted user's focus ring lands somewhere harmless. A
   * keyboard user is dropped at the top of the document and has to traverse the
   * whole list again to reach the row they were working on.
   *
   * So there are two assertions, not one. A panel that moves focus IN and never
   * returns it passes the first and fails the second — which is exactly the
   * state this console was in an hour ago, on surfaces I had just built.
   *
   * **AND THE PANEL NEEDS AN ACCESSIBLE NAME.** Moving focus to an unlabelled
   * region announces nothing, which is the same outcome as not moving it.
   */
  /*
   * ⚠ AND THE RETURN ASSERTION WAS BLIND TO THE ONLY WAY IT ACTUALLY BREAKS.
   *
   * It matched `openerRef.current?.focus()` — **which was present on both
   * panels and had never worked.** Both openers are unmounted while their panel
   * is open (`{panel === 'none' ? …}`, `if (!open) return <Button …>`), so at
   * the moment the close handler ran, `openerRef.current` was `null` and
   * `?.focus()` was a silent no-op.
   *
   * **The call being present is exactly what a reader checks for, and it is
   * what my own focus audit scored as "focus out: yes".** A line that does
   * nothing is worse than a missing line, because both the reader and the check
   * stop looking.
   *
   * **THE DISTINGUISHING PROPERTY IS WHERE THE CALL LIVES.** A restore inside
   * the close handler runs before the opener remounts and cannot work; one in
   * an EFFECT keyed on the closed state runs after the commit that brings the
   * opener back. So this asserts the shape, not the presence — **and the old
   * assertion would have passed on the broken code, which is how it survived.**
   */
  for (const [label, source] of [
    ['the Template panels', templatesScreen],
    ['the Organization template panel', detailScreen],
  ]) {
    checkTrue(`${label} move focus in when they open`, /panelRef\.current\?\.focus\(\)/.test(source));
    checkTrue(
      `${label} return focus to the control that opened them`,
      /openerRef\.current\?\.focus\(\)/.test(source),
    );
    checkTrue(
      `${label} restore focus in an EFFECT, not in the close handler`,
      /useEffect\(\(\) => \{[\s\S]{0,400}?openerRef\.current\?\.focus\(\)/.test(source),
    );
    check(
      `${label} do not focus the opener while it is still unmounted`,
      /const (closePanel|close) = useCallback\(\(\) => \{[\s\S]{0,200}?openerRef\.current\?\.focus\(\)/.test(
        source,
      ),
      false,
    );
    checkTrue(
      `${label} are focusable and named`,
      /tabIndex=\{-1\}/.test(source) && /aria-labelledby=/.test(source),
    );
  }

  /*
   * THE CONFIRMATION GATE'S EXIT, AND THE MECHANISM THAT MAKES IT UNFORGETTABLE.
   *
   * `openerRef` is a REQUIRED prop, so a gate mounted without saying where focus
   * returns does not compile — `architecture.md` §3a's receipt pattern applied
   * to focus. **Both consumers restored nothing before this**, which is the
   * evidence that a per-parent discipline had already failed twice.
   */
  /*
   * READ LOCALLY. `gate` and `identityProse` are declared hundreds of lines
   * below this block, and referencing them here is a temporal dead zone — the
   * same `ReferenceError` this file has produced before. Reading the two files
   * again costs nothing and keeps the assertion where its subject is.
   */
  const gateSource = strip(
    readFileSync(
      join(import.meta.dirname, '..', 'src', 'components', 'ConfirmationGate.tsx'),
      'utf8',
    ),
  );
  const identitySource = strip(
    readFileSync(
      join(import.meta.dirname, '..', 'src', 'components', 'OrganizationIdentity.tsx'),
      'utf8',
    ),
  );

  checkTrue(
    'the confirmation gate REQUIRES an openerRef',
    /readonly openerRef: RefObject<HTMLElement \| null>;/.test(gateSource),
  );
  check(
    'and it is not optional',
    /openerRef\?:/.test(gateSource),
    false,
  );
  checkTrue(
    'the gate restores focus on unmount, and only when dismissed',
    /dismissedRef\.current\) openerRef\.current\?\.focus\(\)/.test(gateSource),
  );
  /*
   * ONE DISMISSAL PATH. `onCancel` is wired to three controls; if any of them
   * calls it directly, that branch skips the restore — and it would be whichever
   * branch nobody tests.
   */
  check(
    'every dismissal goes through one path',
    /onClick=\{onCancel\}/.test(gateSource),
    false,
  );

  /*
   * ESCAPE, ON EVERY DISMISSIBLE SURFACE. The drawer had it and four panels did
   * not — **an affordance that works in one place and silently fails in four is
   * worse than one that exists nowhere**, because it teaches the key and then
   * ignores it.
   */
  for (const [label, source] of [
    ['the confirmation gate', gateSource],
    ['the Template panels', templatesScreen],
    ['the Organization template panel', detailScreen],
    ['the identity edit form', identitySource],
  ]) {
    checkTrue(`${label} close on Escape`, /event\.key === 'Escape'/.test(source));
  }
  /*
   * AND NOT WHILE A WRITE IS IN FLIGHT. Escape during a derivation or a
   * submission would unmount the panel while a confirmed write is travelling,
   * leaving the operator no way to learn the outcome of an act they approved.
   */
  checkTrue(
    'the gate does not listen for Escape while a write is in flight',
    /if \(inFlight\) return undefined;/.test(gateSource),
  );
  checkTrue(
    'and the identity form does not while it is saving',
    /if \(!editing \|\| saving\) return undefined;/.test(identitySource),
  );

  /*
   * THE IDENTITY EDIT FORM HAD NO FOCUS MANAGEMENT AT ALL — not even a call
   * that did nothing. Pressing Edit swapped a read view for a form and left a
   * keyboard user on a button that had just been replaced.
   */
  checkTrue(
    'the identity edit form takes focus when it opens',
    /formRef\.current\?\.focus\(\)/.test(identitySource),
  );
  checkTrue(
    'and returns it to Edit on cancel, from an effect',
    /useEffect\(\(\) => \{[\s\S]{0,300}?editRef\.current\?\.focus\(\)/.test(identitySource),
  );
  checkTrue(
    'and the form is focusable and named',
    /tabIndex=\{-1\}[\s\S]{0,120}aria-label=\{t\('identity\.editForm'\)\}/.test(identitySource),
  );
}

/* =========================================================================
   10a. THE `@dudo/ui` RESERVATION — the half of 0040 nothing was watching
   ========================================================================= */

console.log('\n=== No host-local copy of a shared component ===\n');

/*
 * ===========================================================================
 * ⚠ ADDED 2026-09-11, DURING THE MERGE READING, BECAUSE THE MERGE IS THE EVENT
 * THIS GUARDS AGAINST
 * ===========================================================================
 *
 * `0040` merged two host-local copies of the credential derivation into
 * `@dudo/client-kdf`, **and `packages/testing` carries a tree-scoped
 * reservation so that the day a `kdf*.ts` reappears in either host the suite
 * goes red and names it.** That reservation has a floor and it works.
 *
 * **`0040` ALSO MERGED THE COMPONENTS — `button.tsx`, `field.tsx`, `badge.tsx`
 * and `cn.ts` — INTO `@dudo/ui`, AND NOTHING WATCHES THAT HALF.** Measured
 * during the merge reading: no reservation, in any tree.
 *
 * **`origin/main` still holds all four files**, and they are on the list a
 * merge can resurrect. `workflow.md` §2b's sentence is exact:
 *
 * > **A merge is a way to re-fork a file without anyone deciding to.**
 *
 * **AND THE COMPONENT HALF FAILS MORE QUIETLY THAN THE KDF HALF.** A second
 * `kdf.ts` is a second credential derivation and somebody would eventually
 * notice. **A second `button.tsx` compiles, renders, and drifts** — two
 * stylesheets and two focus rings diverging with no type error and no failed
 * import, which is the defect `§11a` records one layer down about the CSS that
 * stayed behind when the components moved.
 *
 * Tree-scoped, not path-scoped, for the same reason the `platform/web`
 * not-found reservation is: **a path-scoped version is correct today and
 * silently wrong the first time a copy lands somewhere else.**
 */
{
  const SHARED = /^(button|field|badge|cn|spinner|panel|skeleton|toaster)\.(ts|tsx)$/u;
  const hosts = ['admin', 'web'];
  const forks = [];
  let examined = 0;
  for (const host of hosts) {
    const root = join(import.meta.dirname, '..', '..', host, 'src');
    const walk = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') walk(join(directory, entry.name));
          continue;
        }
        examined += 1;
        if (SHARED.test(entry.name)) forks.push(`platform/${host}/src/…/${entry.name}`);
      }
    };
    walk(root);
  }
  /*
   * THE FLOOR: a walk that reached nothing reports "no forks" perfectly. This
   * is the same failure the kdf reservation guards against with its own count,
   * and the one `§11a` records as the empty-list reader.
   */
  console.log(`  … ${String(examined)} file(s) walked across both host trees`);
  checkTrue('the fork scan reached both trees', examined >= 40);
  check('no host-local copy of a component that lives in @dudo/ui', forks.join(', '), '');
}

/* =========================================================================
   10b. SR-20 — the re-template control SHOWS the Organization's status
   ========================================================================= */

console.log('\n=== SR-20: shown, not gated ===\n');

/*
 * **RE-TEMPLATING A SUSPENDED ORGANIZATION IS PERMITTED**, and the reasoning is
 * what produces a client obligation rather than a refusal:
 *
 * > **Refusing the small act forces the big one.** Correcting a Template would
 * > otherwise require reactivating first — restoring a customer's access to
 * > their own product for the sake of a configuration fix. **Correcting
 * > configuration before restoring access is the safer order.**
 *
 * So the operator needs **the fact, not a refusal**: re-templating a suspended
 * Organization without knowing it is suspended is deciding on something they
 * were not shown.
 */
{
  const panel = strip(readScreen('OrganizationDetail.tsx'));

  checkTrue(
    'the re-template panel receives the Organization’s status',
    /organizationStatus=\{detail\.status\}/.test(panel) &&
      /organizationStatus: string;/.test(panel),
  );
  checkTrue(
    'and renders it',
    /organizationStatus !== 'active'[\s\S]{0,600}<StatusBadge status=\{organizationStatus\}/.test(
      panel,
    ),
  );

  /*
   * ⚠ AND IT IS NOT GATED. **A greyed-out control is a promise**, and this is
   * not a promise the client gets to make about an act Core permits. The
   * failure mode is one `disabled=` or one `&&` on the submit, and it would
   * look like caution.
   */
  check(
    'the status does not disable the control',
    /disabled=\{[^}]*organizationStatus/.test(panel),
    false,
  );
  check(
    'and does not gate the panel or the submit',
    /organizationStatus\s*===\s*'active'\s*&&/.test(panel),
    false,
  );

  /*
   * ===================================================================
   * ⚠ THE TRIGGER THE RULING NAMED, ENCODED RATHER THAN LEFT IN PROSE
   * ===================================================================
   *
   * The ruling rests on the status being one a customer **returns from** —
   * both current values are ordinary operator acts in both directions, so
   * configuration is being staged for a return.
   *
   * > **If a terminal state ever ships — pending-deletion, closed — this ruling
   * > does not extend to it, because a terminal state is one that does not come
   * > back.**
   *
   * **A screen built against a two-value status is a screen that silently
   * accepts a third.** So the notice is rendered for every non-`active` value
   * rather than for `'suspended'`, and a comparison against that literal here
   * would be the shape that goes quiet when a third arrives.
   */
  check(
    'the notice is not keyed on the literal "suspended"',
    /organizationStatus\s*===\s*'suspended'/.test(panel),
    false,
  );
  checkTrue(
    'an unrecognised status gets its own sentence rather than being called suspended',
    /isKnownStatus\(organizationStatus\)[\s\S]{0,200}orgTemplate\.statusUnknown/.test(panel),
  );
  /*
   * AND BOTH SENTENCES EXIST IN BOTH LANGUAGES. `statusWhy` is the half that
   * says the act is still allowed — **copy that read as a warning would make an
   * operator hesitate over something the platform deliberately permits**, which
   * is a greyed-out control wearing an explanation.
   */
  for (const key of ['orgTemplate.statusNotice', 'orgTemplate.statusUnknown', 'orgTemplate.statusWhy']) {
    check(
      `${key} is declared in both dictionaries`,
      [...i18nSource.matchAll(new RegExp(`'${key.replace(/\./gu, '\\.')}':`, 'gu'))].length,
      2,
    );
  }
  checkTrue(
    'the ENGLISH reason says the change is still allowed',
    /'orgTemplate\.statusWhy':\s*\n?\s*'[^']*is still allowed/.test(i18nSource),
  );
  checkTrue(
    'and the ARABIC one does too',
    /'orgTemplate\.statusWhy':\s*\n?\s*'[^']*يظلّ تغيير نوع عملها مسموحًا/.test(i18nSource),
  );
}

/* =========================================================================
   10c. THE PLATFORM DASHBOARD — 0042's counts, and what a summary may hold
   ========================================================================= */

console.log('\n=== The dashboard states totals, and holds no tenant data ===\n');

/*
 * ⚠ NOTHING IN THIS FILE ASSERTED ANYTHING ABOUT `Dashboard.tsx` UNTIL NOW.
 *
 * It was the one screen with no checks, and it has just acquired **two audited
 * count calls** — so the properties that were previously true by construction
 * (it renders page lengths, it reads no aggregate) are now decisions somebody
 * could reverse.
 *
 * **`0042` EXISTS FOR ONE SENTENCE**: a paginated list can only say *"at least
 * 25"* until its last page, so an operational summary opened cold has no
 * honest total. These routes were built, registered, audited and **consumed by
 * nothing** until this pass.
 */
{
  const dashboard = strip(readScreen('Dashboard.tsx'));

  checkTrue(
    'the dashboard states a TOTAL rather than a page length',
    /count=\{organizationCount\.data\?\.total\}/.test(dashboard) &&
      /count=\{templateCount\.data\?\.total\}/.test(dashboard),
  );
  check(
    'and no panel reports a list page as if it were a count',
    /count=\{\w+\.data\?\.data\.length\}/.test(dashboard),
    false,
  );
  /*
   * THE TWO COUNTS FAIL INDEPENDENTLY. An operator may hold
   * `core.organization.list` and not `core.template.read`, so a combined query
   * would let one refusal hide the other's answer.
   */
  checkTrue(
    'each count is its own query',
    /useOrganizationCount\(\)/.test(dashboard) && /useTemplateCount\(\)/.test(dashboard),
  );

  /*
   * ⚠ THE PARTIAL BRANCH IS KEPT, NOT DELETED, AND THAT IS THE HONESTY RULE
   * SURVIVING ITS OWN FIX.
   *
   * If a count is ever unavailable and a panel falls back to a page length,
   * **the "at least" qualifier and its explanation must come back with it.**
   * Deleting the branch would make that fallback silently claim a total it does
   * not have — which is the defect `0042` was written to remove, reintroduced
   * by the change that removed it.
   */
  checkTrue(
    'the "at least" qualifier still exists for a fallback that needs it',
    /dashboard\.countIsPartial/.test(dashboard) && /dashboard\.partialExplain/.test(dashboard),
  );

  /*
   * ===================================================================
   * A SUMMARY MAY COUNT PLATFORM OBJECTS AND MAY NOT COUNT BUSINESS RECORDS
   * ===================================================================
   *
   * `security.md` §2a: **a count is safe exactly when its consumer already
   * holds enumeration over the counted population.** Organizations and
   * Templates are platform objects an operator already enumerates; customers,
   * invoices and members are not, and `platform-operator-v1`'s `theLine.out`
   * refuses them because *"how many customers is how a console acquires
   * cross-tenant reach one convenient number at a time."*
   *
   * **And the shape is constrained as well as the subject**: a scalar total and
   * nothing else, because any breakdown transposes into the mapping `0028`
   * Decision 1 refuses. This asserts the dashboard renders no such map.
   */
  for (const forbidden of ['by_status', 'member_count', 'customerCount', 'useOrganizationAuditRead']) {
    check(`the dashboard does not read or render "${forbidden}"`, dashboard.includes(forbidden), false);
  }

  /*
   * NOTHING POLLS. A dashboard is the surface most likely to be left open, and
   * every read here is an audited platform call against a per-operator daily
   * ceiling — so an interval would turn four calls per visit into four per
   * tick. The global client disables all three refetch triggers; this asserts
   * the screen does not re-enable them locally.
   */
  for (const trigger of ['refetchInterval', 'refetchOnWindowFocus', 'refetchOnReconnect', 'setInterval']) {
    check(`the dashboard does not re-enable "${trigger}"`, dashboard.includes(trigger), false);
  }
}

/* =========================================================================
   11. CONFIRMATIONS — confirmation-v1
   ========================================================================= */

console.log('\n=== The binding: body-minus-three UNION path parameters ===\n');

check(
  'the path template is the declaration',
  declaredPathParameters('/api/v1/platform/operators/{principal_id}/revoke').join(','),
  'principal_id',
);
check('a template with no braces declares nothing', declaredPathParameters('/credentials/reset').length, 0);

/*
 * REVOKE: the body is empty, so the binding is the path parameter ALONE. Before
 * the union clause of 2026-09-05 this was the empty object and a confirmation
 * minted for operator A could have been spent on operator B.
 */
{
  const built = buildConfirmedRequest({
    pathTemplate: '/api/v1/platform/operators/{principal_id}/revoke',
    pathValues: { principal_id: 'pr_target_0000000001' },
    bodyFields: {},
  });
  check('revoke binds exactly one parameter', Object.keys(built.parameters).join(','), 'principal_id');
  check('and it is the target', built.parameters.principal_id, 'pr_target_0000000001');
  check('the URL substitutes it', built.path, '/api/v1/platform/operators/pr_target_0000000001/revoke');
  check('the submission body is empty', Object.keys(built.bodyWithoutConfirmation).length, 0);
}

/* THE DECODED SEGMENT IS BOUND; THE ENCODED ONE GOES IN THE URL. */
{
  const built = buildConfirmedRequest({
    pathTemplate: '/api/v1/platform/operators/{principal_id}/revoke',
    pathValues: { principal_id: 'a b/c' },
    bodyFields: {},
  });
  check('the bound value is the DECODED segment', built.parameters.principal_id, 'a b/c');
  checkTrue('the URL carries the encoded form', built.path.includes('a%20b%2Fc'));
  check('and the two differ, which is the point', built.parameters.principal_id === 'a%20b%2Fc', false);
}

/* A numeric-looking segment binds as a STRING and is never coerced. */
{
  const built = buildConfirmedRequest({
    pathTemplate: '/x/{principal_id}',
    pathValues: { principal_id: '42' },
    bodyFields: {},
  });
  check('a numeric-looking segment binds as a string', typeof built.parameters.principal_id, 'string');
  check('and its value is "42", not 42', built.parameters.principal_id, '42');
}

/*
 * RESET: no path parameters, so the binding is body-minus-three — which
 * INCLUDES `derived_value`, the new credential. That is what forces the password
 * to be generated before the challenge.
 */
{
  const built = buildConfirmedRequest({
    pathTemplate: '/api/v1/platform/credentials/reset',
    pathValues: {},
    bodyFields: {
      principal_id: 'pr_x',
      target_identifier: 'someone@example.com',
      derived_value: 'A'.repeat(43),
    },
  });
  check(
    'reset binds all three body fields',
    Object.keys(built.parameters).sort().join(','),
    'derived_value,principal_id,target_identifier',
  );
  check('the path has no substitution', built.path, '/api/v1/platform/credentials/reset');
  check(
    'the submission body equals the bound parameters when there are no path parameters',
    JSON.stringify(Object.keys(built.bodyWithoutConfirmation).sort()),
    JSON.stringify(Object.keys(built.parameters).sort()),
  );
}

console.log('\n=== The binding refuses what would make it ambiguous ===\n');

for (const [label, input] of [
  [
    'a reserved name as a body field',
    { pathTemplate: '/x', pathValues: {}, bodyFields: { confirmation_id: 'c' } },
  ],
  [
    'a reserved name as a path parameter',
    { pathTemplate: '/x/{reauth_identifier}', pathValues: { reauth_identifier: 'a' }, bodyFields: {} },
  ],
  [
    'reauth_derived_value as a body field',
    { pathTemplate: '/x', pathValues: {}, bodyFields: { reauth_derived_value: 'v' } },
  ],
  [
    'a name that is both a path parameter and a body field',
    { pathTemplate: '/x/{principal_id}', pathValues: { principal_id: 'a' }, bodyFields: { principal_id: 'b' } },
  ],
  [
    'a declared path parameter with no value',
    { pathTemplate: '/x/{principal_id}', pathValues: {}, bodyFields: {} },
  ],
  [
    'a path value the template does not declare',
    { pathTemplate: '/x', pathValues: { principal_id: 'a' }, bodyFields: {} },
  ],
]) {
  try {
    buildConfirmedRequest(input);
    failures += 1;
    console.log(`FAIL  ${label} is refused\n        expected a throw, got none`);
  } catch {
    console.log(`PASS  ${label} is refused`);
  }
}

console.log('\n=== The challenge, and the locale this console never asks for ===\n');

const CHALLENGE = {
  confirmation_id: 'cf_synthetic_00000000001',
  statement: 'This will reset the password for principal pr_x and sign them out everywhere.',
  statement_locale: 'en',
  expires_at: '2026-09-05T10:05:00.000Z',
};

const parsedChallenge = parseConfirmationChallenge(CHALLENGE);
check('the statement is carried verbatim', parsedChallenge.statement, CHALLENGE.statement);
check('statement_locale is carried', parsedChallenge.statement_locale, 'en');
checkTrue('an English statement is presentable', isPresentableStatement(parsedChallenge));
check(
  'a NON-ENGLISH statement is NOT presentable, so no approve control is offered',
  isPresentableStatement({ ...parsedChallenge, statement_locale: 'ar' }),
  false,
);

for (const field of ['confirmation_id', 'statement', 'statement_locale', 'expires_at']) {
  const body = { ...CHALLENGE };
  delete body[field];
  try {
    parseConfirmationChallenge(body);
    failures += 1;
    console.log(`FAIL  a challenge missing "${field}" is refused\n        expected a throw`);
  } catch {
    console.log(`PASS  a challenge missing "${field}" is refused`);
  }
}

{
  const { impl, calls } = stubFetch(jsonResponse(CHALLENGE, 201));
  await createPlatformClient({ fetchImpl: impl }).requestConfirmation({
    actionId: 'platform.credentials.reset',
    parameters: { principal_id: 'pr_x' },
  });
  check('the challenge path', calls[0].url, '/api/v1/platform/confirmations');
  check('it is a POST', calls[0].init.method, 'POST');
  const sent = JSON.parse(calls[0].init.body);
  check('exactly two fields are sent', Object.keys(sent).sort().join(','), 'action_id,parameters');
  /*
   * NO `locale` FIELD, EVER. Absent means English. The non-English statement
   * catalog has never been reviewed by a speaker of the language, and a human is
   * being asked to APPROVE the sentence.
   */
  check('no locale is requested', 'locale' in sent, false);
}

console.log('\n=== The submission: three fields merged, token echoed ===\n');

{
  const merged = withConfirmation(
    { principal_id: 'pr_x', target_identifier: 'a@b.co', derived_value: 'D'.repeat(43) },
    {
      confirmationId: 'cf_ISSUED_EXACTLY_THIS',
      reauthIdentifier: 'operator@example.com',
      reauthDerivedValue: 'R'.repeat(43),
    },
  );
  check(
    'the three confirmation fields are MERGED, not wrapped',
    Object.keys(merged).sort().join(','),
    'confirmation_id,derived_value,principal_id,reauth_derived_value,reauth_identifier,target_identifier',
  );
  check('the token is echoed byte-for-byte', merged.confirmation_id, 'cf_ISSUED_EXACTLY_THIS');
  check('no envelope key is introduced', 'confirmation' in merged, false);
}

{
  const { impl, calls } = stubFetch(
    jsonResponse({ principal_id: 'pr_x', was_self: false, remaining_operator_count: 2 }),
  );
  await createPlatformClient({ fetchImpl: impl }).revokeOperator({
    path: '/api/v1/platform/operators/pr_x/revoke',
    bodyWithoutConfirmation: {},
    confirmationId: 'cf_a',
    reauthIdentifier: 'op@example.com',
    reauthDerivedValue: 'R'.repeat(43),
  });
  const sent = JSON.parse(calls[0].init.body);
  check('revoke sends only the three fields', Object.keys(sent).sort().join(','), 'confirmation_id,reauth_derived_value,reauth_identifier');
  check('and no target in the body — it is the path', 'principal_id' in sent, false);
}

console.log('\n=== The password never leaves, and is never named ===\n');

const gate = strip(
  readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'ConfirmationGate.tsx'), 'utf8'),
);
const resetScreen = strip(readScreen('ResetCredential.tsx'));
const confirmationModule = strip(
  readFileSync(join(import.meta.dirname, '..', 'src', 'api', 'confirmation.ts'), 'utf8'),
);

for (const [label, source] of [
  ['the confirmation gate', gate],
  ['the reset screen', resetScreen],
  ['the confirmation module', confirmationModule],
]) {
  check(`${label} logs nothing`, /console\s*\./.test(source), false);
  check(
    `${label} never persists anything`,
    /(localStorage|sessionStorage)\s*\.\s*setItem/.test(source),
    false,
  );
}

/* The typed password is cleared before the submission is sent. */
checkTrue(
  'the gate clears the password before submitting',
  /setPassword\(''\);[\s\S]{0,200}setPhase\(\{\s*kind:\s*'submitting'/.test(gate),
);
checkTrue('and clears it on every failure path', /catch[\s\S]{0,120}setPassword\(''\)/.test(gate));

/* THE STATEMENT IS RENDERED VERBATIM — one interpolation, no transformation. */
checkTrue('the statement is rendered as a bare interpolation', /\{challenge\.statement\}/.test(gate));
check(
  'the statement is never transformed',
  /statement\s*\.\s*(replace|slice|toUpperCase|toLowerCase|trim|split|substring|normalize)/.test(gate),
  false,
);
check(
  'and never composed from the parameters',
  /statement\s*=\s*[`'"]|`[^`]*\$\{[^}]*parameters/.test(gate),
  false,
);

/*
 * ===========================================================================
 * AND THE COPY PASS MUST NOT HAVE TRANSLATED IT — A NEW WAY TO BREAK AN OLD
 * RULE
 * ===========================================================================
 *
 * Every check above guards against the gate EDITING the statement. **Passing it
 * through `t()` is not an edit in any of their senses** — no `.replace`, no
 * template literal, no composition from parameters — and it would replace Core's
 * sentence with one from this console's dictionary, which is precisely what
 * *"the party being constrained does not author the statement of the
 * constraint"* forbids.
 *
 * **It became reachable the day this file gained a `t`**, and none of the three
 * existing checks would have seen it. A rule can acquire a new way to be broken
 * without anything about the rule changing.
 */
check(
  'the statement is never passed through the dictionary',
  /t\(\s*challenge\.statement|t\(\s*[`'"]?statement/.test(gate),
  false,
);
/*
 * AND IT IS NOT IN THE DICTIONARY EITHER. The check above reads the component;
 * this reads the other end — a statement sentence copied into `en`/`ar` would be
 * the same defect arriving from the opposite direction, and it is the shape
 * somebody produces while "completing the translation".
 */
check(
  'no statement sentence has been copied into the dictionary',
  /'This will reset the password for|'This will retire|'This will remove/.test(i18nSource),
  false,
);

/*
 * THE STATEMENT CARRIES ITS OWN `lang` AND `dir`, NOT THE PAGE'S.
 *
 * An English sentence inside an Arabic page announced by an Arabic synthesiser
 * is *"unusable rather than merely wrong"* (`lib/i18n.tsx`'s own words about
 * `lang`), and an LTR sentence laid out in an RTL block is reordered around its
 * punctuation. **This is the sentence being approved** — it is the last place in
 * the console where either should be allowed to go wrong.
 */
checkTrue(
  'the statement declares its own language',
  /id=\{statementId\}[\s\S]{0,200}lang=\{challenge\.statement_locale\}/.test(gate),
);
checkTrue(
  'and its own direction, resolved from that language rather than the page',
  /dir=\{statementDir\}/.test(gate) && /directionOf\(statementLocale\)/.test(gate),
);
/*
 * AND THE READER IS TOLD WHEN THE TWO DIFFER. The gate already refuses a
 * statement in an UNEXPECTED language; nothing looked at whether the READER
 * reads it. That case did not exist until this console could be Arabic.
 */
checkTrue(
  'a statement in a language the reader did not choose is named',
  /challenge\.statement_locale !== locale/.test(gate) &&
    /gate\.statementLanguageLead/.test(gate),
);
/*
 * ⚠ AND IT IS NAMED, NOT BLOCKED — WHICH IS A JUDGEMENT AND THEREFORE OWED AN
 * ASSERTION.
 *
 * Refusing to offer approval when the console is Arabic would make the language
 * switch a downgrade, and the operator population here reads English. **That is
 * a decision rather than a fact**, it is recorded in the component header and
 * handed to the Team Lead, and the thing that would quietly reverse it is one
 * `&& !readerCannotBeAssumed` on the form's condition — a change that looks like
 * caution.
 *
 * So the form's gate stays exactly `presentable`, and this goes red if the
 * notice ever starts deciding whether the action is offered. **A check on the
 * judgement, not on the behaviour.**
 *
 * (Written because a negative control existed for this and no check did — the
 * third time in this session that writing a control reached a guarantee nobody
 * had encoded.)
 */
checkTrue(
  'the language notice does not gate the approve form',
  /\{presentable \? \(\s*<form/.test(gate),
);

/* No speculative challenges. */
check(
  'the gate requests no challenge on hover or focus',
  /onMouseEnter|onFocus[\s\S]{0,200}requestChallenge/.test(gate),
  false,
);
check(
  'the operators screen opens the gate only from a click',
  /onMouseEnter[\s\S]{0,200}setRevoking/.test(strip(readScreen('Operators.tsx'))),
  false,
);

/* The reset derives with the TARGET's identifier, the gate with the CALLER's. */
checkTrue(
  'the reset salts the new credential with the target identifier',
  /createOnboardingCredential\(targetIdentifier/.test(resetScreen),
);
check(
  'the reset screen never handles a reauth value itself',
  /reauth_derived_value|reauthDerivedValue\s*=/.test(resetScreen),
  false,
);

console.log('\n=== A reset that fails AFTER approval: refused vs unknown ===\n');

/*
 * THE DANGEROUS CASE IS NOT FAILURE, IT IS NOT KNOWING. Getting this wrong one
 * way hands a customer a password that was never written; the other way discards
 * the only copy of one that is live.
 */
checkTrue(
  'the reset distinguishes a refusal from an indeterminate outcome',
  /writeIsCertainlyAbsent/.test(resetScreen),
);
checkTrue(
  'a refusal and an unknown outcome are separate render paths',
  /certainlyNotWritten/.test(resetScreen),
);
/*
 * ON AN INDETERMINATE OUTCOME THE PASSWORD IS STILL SHOWN. If the write landed,
 * this browser holds the only copy; discarding it strands the account
 * permanently, while showing an inert string costs nothing.
 */
checkTrue(
  'the uncertain branch still renders the password',
  /ResetUncertain[\s\S]*?credential\.password/.test(resetScreen),
);
/*
 * ⚠ THIS WAS AN ENGLISH TRANSCRIPTION AND THE ARABIC PASS BROKE IT — the fourth
 * assertion of that shape to break the same way. It read
 * `/not known whether|Possibly-live/` against the SCREEN, and the screen now
 * names message keys.
 *
 * **Split, as the others were: the screen must USE the key, and the dictionary
 * must SAY the thing.** Those are two different claims and only the pair is
 * the guarantee.
 *
 * **AND THIS SCREEN GETS THE STRICTER TREATMENT, WHICH THE OTHERS DO NOT.**
 * Elsewhere only the English value is pinned, because `Record<MessageKey,
 * string>` guarantees an Arabic value EXISTS. It does not guarantee the Arabic
 * value still hedges — and here the hedge IS the safety property: an Arabic
 * translation that firmed "it is not known whether" into "the password was
 * reset" would compile, read fluently, and tell an operator to send a customer
 * a password that may never have been written. **So a short Arabic fragment is
 * pinned too.** A fragment rather than the sentence, so ordinary copy polish
 * does not go red.
 */
checkTrue(
  'and says plainly that it may or may not be live',
  /reset\.unknown\.title/.test(resetScreen) &&
    /reset\.unknown\.passwordLabel/.test(resetScreen),
);
checkTrue(
  'and the ENGLISH dictionary carries the hedge',
  /'reset\.unknown\.title': 'It is not known whether/.test(i18nSource) &&
    /'reset\.unknown\.passwordLabel': 'Possibly-live password'/.test(i18nSource),
);
checkTrue(
  'and the ARABIC dictionary carries it too, because a firmed translation is the hazard',
  /'reset\.unknown\.title': 'لا يُعرف/.test(i18nSource) &&
    /'reset\.unknown\.passwordLabel': '[^']*قد تكون فعّالة/.test(i18nSource),
);
/*
 * A SUBMISSION FAILURE IS NOT ROUTED THROUGH THE GATE'S GENERIC HANDLER, whose
 * "Nothing was changed" is true for a challenge that never issued and MAY BE
 * FALSE for a submission that timed out.
 */
checkTrue(
  'the reset catches its own submission failure rather than rethrowing',
  /catch\s*\([\s\S]{0,80}onFailedAfterApproval/.test(resetScreen),
);

/*
 * THE CLASSIFICATION ITSELF, EXERCISED RATHER THAN GREPPED. Refusals are
 * decisions Core made before writing; transport and server faults are not. This
 * calls the real function — a regex over the source would pass on a file that
 * merely mentions the codes.
 *
 * EVERY CODE IN THE ENVELOPE IS COVERED, so a new one cannot be added without
 * this failing and forcing a decision about which side it falls on. An
 * unclassified code defaulting to "nothing was written" is the dangerous
 * default, and this is what stops it arriving silently.
 */
{
  const certain = [
    'conflict',
    'quota_exceeded',
    'rate_limited',
    'forbidden',
    'not_found',
    'invalid_argument',
    'failed_precondition',
  ];
  const uncertain = ['unavailable', 'timeout', 'internal', 'unauthenticated'];

  for (const code of certain) {
    checkTrue(`${code} -> nothing was written`, writeIsCertainlyAbsent({ code }));
  }
  for (const code of uncertain) {
    check(`${code} -> outcome UNKNOWN, not "nothing happened"`, writeIsCertainlyAbsent({ code }), false);
  }
  check(
    'every error code in the envelope is classified',
    [...certain, ...uncertain].sort().join(','),
    [...ERROR_CODES].sort().join(','),
  );
}

/*
 * =========================================================================
 * THE ERROR COPY — AND UNTIL NOW NOTHING CHECKED A WORD OF IT
 * =========================================================================
 *
 * `api/errors.ts` holds the sentences EVERY failed request on EVERY screen
 * renders, and it is a `.ts` module, so **the copy-coverage pin has never seen
 * it and no assertion has ever read it.** Sixteen operator-facing strings, on
 * the states an operator meets when something has just gone wrong, with no
 * coverage of any kind.
 */
{
  /*
   * EVERY CODE HAS A TITLE, EXERCISED RATHER THAN GREPPED — and every title
   * resolves in BOTH dictionaries. `Record<ErrorCode, ErrorMessageKey>` makes
   * the first a compile error and `Record<MessageKey, string>` makes the second
   * one; this asserts the composition, which neither type sees on its own.
   */
  const enBlock = /export const en = \{([\s\S]*?)\n\} as const;/u.exec(i18nSource)?.[1] ?? '';
  const arBlock =
    /export const ar: Record<MessageKey, string> = \{([\s\S]*?)\n\};/u.exec(i18nSource)?.[1] ?? '';
  const entries = (block) =>
    new Map([...block.matchAll(/'([\w.]+)':\s*\n?\s*'([^']*)'/gu)].map((m) => [m[1], m[2]]));
  const enMap = entries(enBlock);
  const arMap = entries(arBlock);
  console.log(
    `  … ${String(enMap.size)} English and ${String(arMap.size)} Arabic dictionary entries parsed`,
  );
  /* The floor: two empty maps would agree perfectly and prove nothing. */
  checkTrue('the dictionary parse reached both blocks', enMap.size >= 200 && arMap.size >= 200);

  const missing = [];
  const withBody = [];
  for (const code of ERROR_CODES) {
    const titleKey = errorTitleKey({ code });
    if (!enMap.has(titleKey) || !arMap.has(titleKey)) missing.push(`title:${code}`);
    /*
     * `errorBodyKey` TAKES A FULL `ApiError`, and it must be given one rather
     * than a `{ code }` literal: it reads `retry_after_seconds` to choose
     * between two `rate_limited` sentences, and a bare object has no such field
     * — so the wrong branch would be exercised and the check would pass on a
     * key nobody reaches.
     */
    const bodyKey = errorBodyKey(new ApiError({ code }));
    if (bodyKey === null) continue;
    withBody.push(code);
    if (!enMap.has(bodyKey) || !arMap.has(bodyKey)) missing.push(`body:${code}`);
  }
  check('every error title and body resolves in both languages', missing.join(','), '');
  /*
   * A FLOOR ON THE POPULATION, not just on the result. If `errorBodyKey` ever
   * returned `null` for everything, the loop above would examine nothing and
   * report a clean sweep — `§11a`'s empty-list reader, wearing a for-loop.
   *
   * ⚠ **I PREDICTED TWO AND THE RUN SAID THREE**, which is the check earning
   * its place on its first execution. The three defer for **two different
   * reasons**, and writing the assertion is what made me go and find the second:
   *
   *   `invalid_argument`, `conflict`  Core knows WHICH FIELD and this console
   *                                   does not, so its message beats any generic
   *                                   sentence written here.
   *   `quota_exceeded`                it is a CEILING. `isCeilingCode` claims it
   *                                   for `CeilingNotice`, which writes its own
   *                                   copy scoped to platform or organization —
   *                                   two ledgers that mean opposite things. A
   *                                   generic body here would be dead on the
   *                                   path that renders, and contradictory on
   *                                   the one that does not.
   *
   * **Both are correct and neither was written down anywhere.** The assertion is
   * now the record, and adding a fourth deferral means stating its reason here.
   */
  console.log(`  … ${String(withBody.length)} of ${String(ERROR_CODES.length)} codes carry a console-written body`);
  check(
    'the codes deferring to Core or to CeilingNotice are exactly the three expected',
    ERROR_CODES.filter((code) => !withBody.includes(code)).sort().join(','),
    'conflict,invalid_argument,quota_exceeded',
  );
  /*
   * AND THE CEILING DEFERRAL IS TIED TO THE COMPONENT THAT JUSTIFIES IT. If
   * `isCeilingCode` ever stops claiming `quota_exceeded`, that code starts
   * rendering through `ErrorBlock` with no body at all — and this goes red
   * naming the reason, rather than the gap being found by an operator.
   */
  /*
   * READ AS SOURCE RATHER THAN CALLED, and the reason is the one
   * `writeIsCertainlyAbsent` gives for living in `errors.ts` at all:
   * **`CeilingNotice.tsx` is a `.tsx` file, which Node's type stripping cannot
   * load.** So this is a weaker instrument than the exercised checks above — it
   * proves the branch is written, not that it decides correctly — and saying so
   * is better than letting a regex read as an execution.
   */
  const ceilingSource = strip(
    readFileSync(
      join(import.meta.dirname, '..', 'src', 'components', 'CeilingNotice.tsx'),
      'utf8',
    ),
  );
  checkTrue(
    'and CeilingNotice still claims the ceiling code that has no body here',
    /function isCeilingCode[\s\S]{0,200}'quota_exceeded'/.test(ceilingSource) &&
      !withBody.includes('quota_exceeded'),
  );

  /*
   * =======================================================================
   * AN ERROR THIS CLIENT BUILT CARRIES ITS OWN KEY, AND THE WIRE CANNOT
   * =======================================================================
   *
   * `invalid_argument` defers to Core's `message` because **Core knows which
   * field and this console does not.** There is exactly one instance where that
   * is false: the identity save refusing an empty change set locally, which
   * never reached Core. Without a key it rendered an English sentence written
   * here, on the one code whose deferral rule assumes the opposite.
   *
   * **It was found by asking which remaining `.ts` strings can REACH a screen**,
   * not by the coverage pin — which does not scan `.ts` — and not by any check.
   */
  check(
    'a client-built error resolves to its own key, not to Core’s message',
    errorBodyKey(
      new ApiError({ code: 'invalid_argument', messageKey: 'error.body.nothingChanged' }),
    ),
    'error.body.nothingChanged',
  );
  check(
    'and it still defers when no key is set',
    errorBodyKey(new ApiError({ code: 'invalid_argument', message: 'x' })),
    null,
  );
  /*
   * ⚠ **A SERVER MAY NOT SELECT THIS CONSOLE'S COPY.** `ErrorEnvelope` has no
   * `messageKey` property, so `fromEnvelope` cannot set one — it is `undefined`
   * by construction rather than by a check anyone has to remember. This asserts
   * the construction, because the property is one field away from being
   * spreadable straight off the wire, and the next author adding a field to the
   * envelope is the person who would do it.
   */
  check(
    'an error from the wire carries no message key, whatever it sends',
    ApiError.fromEnvelope({
      error: {
        code: 'forbidden',
        message: 'spoofed',
        request_id: 'rq_1',
        messageKey: 'error.body.nothingChanged',
      },
    }).messageKey,
    null,
  );

  /*
   * ⚠ THE `forbidden` BODY MAY NOT NAME A CONDITION, IN EITHER LANGUAGE.
   *
   * Core returns ONE argument-free `forbidden` for four conditions — no operator
   * row, an unrecognised role, a role lacking the permission, **and a principal
   * present in both the operator and membership tables.** The fourth is the
   * reason they are indistinguishable: a caller who could detect the
   * mutual-exclusion refusal could probe `organization_membership` through these
   * routes.
   *
   * **So "you are not a platform operator" is not merely unhelpful — it is FALSE
   * on the fourth condition and it is the sentence a translator would naturally
   * reach for**, because it is shorter and reads better than the hedge. The
   * hedge is the security property.
   *
   * This is the one place a translation could re-open a disclosure the contract
   * spent a paragraph closing, and `Record<MessageKey, string>` cannot see it:
   * a wrong sentence is still a string.
   */
  for (const [label, map, banned] of [
    ['ENGLISH', enMap, /\bnot (a|an) (platform )?operator\b|no operator row|lacks? the permission/iu],
    ['ARABIC', arMap, /لست مشغّلًا|لا تملك صلاحية|غير مشغّل/u],
  ]) {
    check(
      `the ${label} forbidden body does not name which condition applied`,
      banned.test(map.get('error.body.forbidden') ?? ''),
      false,
    );
    checkTrue(
      `and the ${label} forbidden body says the refusal is unspecific`,
      (map.get('error.body.forbidden') ?? '').length > 40,
    );
  }
  checkTrue(
    'the ENGLISH forbidden body says so in as many words',
    /deliberately unspecific/.test(enMap.get('error.body.forbidden') ?? ''),
  );
  checkTrue(
    'and the ARABIC one does too',
    /غير محدّد عمدًا/.test(arMap.get('error.body.forbidden') ?? ''),
  );

  /*
   * THE RETRY-AFTER SENTENCE GOES THROUGH `Intl`, NOT THROUGH A NUMERAL. It
   * carries `{seconds}`, which the caller fills with `formatSeconds` — so
   * Arabic gets ثانية / ثانيتان / ثوانٍ from the engine. A dictionary that
   * spelled "seconds" would be a plural rule written by hand, which this module
   * disclaims.
   */
  check(
    'the rate-limit wait is a placeholder in both languages',
    [enMap, arMap].filter((m) => /\{seconds\}/u.test(m.get('error.body.rateLimitedFor') ?? ''))
      .length,
    2,
  );
  check(
    'and neither spells a unit of time beside it',
    [enMap, arMap].filter((m) =>
      /\{seconds\}\s*(seconds|ثانية|ثوان)/u.test(m.get('error.body.rateLimitedFor') ?? ''),
    ).length,
    0,
  );

  /*
   * NO SCREEN RENDERS ENGLISH ERROR PROSE ANY MORE. The functions returned
   * sentences; a caller that still expects one would be reading a key as text.
   */
  for (const name of ['StateBlock.tsx', 'SignIn.tsx']) {
    const source = strip(
      readFileSync(
        join(
          import.meta.dirname,
          '..',
          'src',
          name === 'StateBlock.tsx' ? 'components' : 'screens',
          name,
        ),
        'utf8',
      ),
    );
    check(`${name}: no caller expects prose from the error module`, /\berrorTitle\(|\berrorBody\(/.test(source), false);
  }
}

/* And the reasoning that stops the ordering being "simplified" away. */
checkTrue(
  'the file records why derived_value must be generated before the challenge',
  /DO NOT "SIMPLIFY" THIS BY GENERATING THE PASSWORD AFTER THE CONFIRMATION/.test(
    readScreen('ResetCredential.tsx'),
  ),
);

/* =========================================================================
   11b. THE LEAF MODULE, AND WHY A ONE-LINE CHECK EARNS ITS PLACE HERE
   =========================================================================
   `lib/routes.ts` holds the four section paths. It exists because putting them
   in `routes/route-tree.tsx` — beside the routes that use them, which is where
   they read as belonging — created a cycle:

       route-tree -> root-layout -> AdminShell -> route-tree

   THE CONSOLE RENDERED A BLANK PAGE, and `tsc`, `vite build` and 584 assertions
   in this very file were all green while it did. A module cycle is a property of
   the IMPORT GRAPH rather than of any file, so nothing here could see it.

   THIS CHECK CANNOT SEE A CYCLE EITHER. What it can do is hold the one property
   that prevents this one: the module at the bottom of the graph imports nothing.
   It is not a substitute for `npm run smoke`, which loads the page; it is the
   cheap half that fails in milliseconds instead of after a build and a browser.
   ========================================================================= */

console.log('\n=== The section paths live in a module that imports nothing ===\n');

{
  const routesSource = readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'routes.ts'), 'utf8');
  const imports = (strip(routesSource).match(/^\s*import\b/gm) ?? []).length;
  check('lib/routes.ts has zero imports, so it cannot be in a cycle', imports, 0);
  checkTrue(
    'and it is what actually declares the section paths',
    /export const ROUTES\s*=/.test(routesSource) && /organizations|templates|operators|audit/.test(routesSource),
  );
}

/* =========================================================================
   12. ACCESSIBILITY — structure, roles and focus, asserted from the source
   =========================================================================
   WHAT THESE CAN AND CANNOT DO, STATED HERE SO THE COUNT IS NOT MISREAD.
   They assert that the STRUCTURE exists: roles, labels, associations, focus
   moves, explicit button types. **They cannot assert that a screen reader
   announces any of it well.** There is no browser and no assistive technology
   here. This is an accessibility PASS bounded to what a source check can see,
   not an accessibility CLAIM.
   ========================================================================= */

console.log('\n=== Buttons: an untyped button inside a form SUBMITS it ===\n');

/*
 * HTML's default is `type="submit"`. `ConfirmationGate`'s Cancel sat inside the
 * approval form untyped, so clicking it fired `onCancel` AND `onSubmit` — with
 * both re-auth fields filled it would have carried out the destructive action
 * the operator had just declined.
 */
/*
 * THE BUTTON MOVED TO `@dudo/ui` (ADR 0040), AND THIS ASSERTION FOLLOWED IT.
 *
 * A CHANGE OF SUBJECT, NOT A WEAKENING — AND IT IS STRICTLY STRONGER NOW. The
 * `type="button"` default this checks used to belong to this console alone;
 * `platform/web`'s copy did NOT have it, which is why web carries five call
 * sites that each write `type="button"` by hand. There is one Button now, so
 * this assertion protects both consoles.
 *
 * Read from `packages/ui/src/` rather than through `node_modules/@dudo/ui`: the
 * workspace link is a symlink, and a check that reads through one is asserting
 * about however npm laid the tree out rather than about the source.
 */
const buttonSource = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'packages', 'ui', 'src', 'button.tsx'),
  'utf8',
);
checkTrue(
  'Button defaults to type="button", so a control must ASK to submit',
  /type\s*=\s*'button'/.test(strip(buttonSource)),
);
checkTrue(
  'and the default is actually applied to the element',
  /<button\s+type=\{type\}/.test(strip(buttonSource)),
);

console.log('\n=== The confirmation flow ===\n');

/*
 * A STATEMENT A SCREEN READER SKIPS IS A STATEMENT NOBODY APPROVED. A paragraph
 * is not in the tab order, so someone tabbing to the password field would
 * otherwise hear nothing about what they are approving.
 */
checkTrue('the statement has an id that can be referenced', /id=\{statementId\}/.test(gate));
checkTrue(
  'the statement is the accessible description of its region',
  /aria-describedby=\{statementId\}[\s\S]{0,400}id=\{statementId\}/.test(gate),
);
checkTrue(
  'and of the approve control, so it is announced at the moment of decision',
  (gate.match(/aria-describedby=\{statementId\}/g) ?? []).length >= 2,
);
checkTrue(
  'focus moves to the statement when the challenge arrives',
  /statementRef\.current\?\.focus\(\)/.test(gate),
);
/*
 * GENERATED IDS. This component is used by two screens; a literal `id` would be
 * a duplicate if two ever coexisted, and `aria-describedby` resolves to the
 * FIRST match — announcing the wrong action's statement.
 */
checkTrue('the ids are generated, not literal', /useId\(\)/.test(gate));
check(
  'no hardcoded confirmation id remains',
  /id="confirmation-heading"/.test(gate),
  false,
);

console.log('\n=== The reset outcome panels are announced and focused ===\n');

for (const [label, pattern] of [
  ['the success panel is a live region', /role="status"[\s\S]{0,200}aria-live="polite"/],
  ['both outcome panels take focus', /panelRef\.current\?\.focus\(\)/],
  ['the uncertain panel is assertive', /role="alert"/],
]) {
  checkTrue(label, pattern.test(resetScreen));
}
/*
 * The `<dt>` naming that password is what a screen reader reads before the
 * value, so the hedge has to be in the LABEL rather than only in the paragraph
 * above it. Same split as above — the screen names the key, the dictionaries
 * carry the words.
 */
checkTrue(
  'the possibly-live password is labelled as such for a screen reader',
  /reset\.unknown\.passwordLabel/.test(readScreen('ResetCredential.tsx')),
);

console.log('\n=== RTL: direction-dependent content ===\n');

/*
 * A LITERAL ARROW DOES NOT FLIP. In RTL "back" points right, and `&larr;` keeps
 * pointing left — aiming away from where the reader came from.
 */
for (const name of ['OrganizationAudit.tsx', 'PlatformAudit.tsx', 'Operators.tsx', 'Templates.tsx', 'SignIn.tsx', 'ResetCredential.tsx']) {
  const source = readScreen(name);
  check(
    `${name}: no hard-coded directional arrow`,
    /&larr;|&rarr;|←|→/.test(strip(source)),
    false,
  );
}
checkTrue(
  'the back control uses a mirroring icon instead',
  /rtl:-scale-x-100/.test(readScreen('OrganizationAudit.tsx')),
);

console.log('\n=== Landmarks, labels and focus order ===\n');

const shell = strip(
  readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'AdminShell.tsx'), 'utf8'),
);
/*
 * ⚠ THIS ASSERTED THE LITERAL `aria-label="Sections"` AND WENT RED WHEN THE
 * CONSOLE LEARNED ARABIC. Rewritten 2026-09-11 to the property.
 *
 * **It had transcribed the English text of the label**, so it was not checking
 * that the landmark has an accessible name — it was checking that the name was
 * one particular English word. `workflow.md` §11a: derive the subject, never
 * transcribe it. **The check going red on a correct translation is the same
 * failure as the `nonce` grep going red on a correct conversion.**
 *
 * The replacement is STRICTER than what it replaces, because a literal would
 * now satisfy the old regex and be a bug: the label must be present AND must
 * come from the dictionary. **A hard-coded English `aria-label` is an
 * untranslated landmark, which is worse than an untranslated heading — a
 * screen-reader user navigating by landmark has nothing else to go on.**
 */
checkTrue(
  'the navigation is a labelled landmark',
  /<nav[\s\S]{0,300}aria-label=\{/.test(shell),
);
checkTrue(
  'and its label is translated rather than hard-coded English',
  /<nav[\s\S]{0,300}aria-label=\{t\(/.test(shell),
);
checkTrue('the main region is addressable by the skip link', /id="main"/.test(shell));

/*
 * ===========================================================================
 * ARABIC AND ENGLISH — WHAT IS ASSERTED, AND WHAT DELIBERATELY IS NOT
 * ===========================================================================
 *
 * **The completeness of the translation is enforced by the COMPILER, not
 * here.** `ar` is typed `Record<keyof typeof en, string>`, so an English key
 * without an Arabic one fails `tsc` and names the key. A check counting keys
 * would be a second, weaker copy of a guarantee that already cannot be evaded
 * — `workflow.md` §11a's duplicate-check test: it would go red on no input the
 * typecheck passes.
 *
 * **So what is left for this file is the part types cannot see**, and it is the
 * part that decays: that the two dictionaries have not drifted into different
 * SHAPES, that direction is derived rather than guessed per component, and that
 * the population is reported so a dictionary which stops growing says so.
 */
{
  const i18n = strip(
    readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'i18n.tsx'), 'utf8'),
  );
  const keysIn = (block) => (block.match(/^\s{2}'[a-z][\w.]*':/gmu) ?? []).length;
  const enBlock = /export const en = \{([\s\S]*?)\n\} as const;/u.exec(i18n)?.[1] ?? '';
  const arBlock = /export const ar: Record<MessageKey, string> = \{([\s\S]*?)\n\};/u.exec(i18n)?.[1] ?? '';

  console.log(
    `  … messages: ${String(keysIn(enBlock))} en · ${String(keysIn(arBlock))} ar`,
  );
  /* A floor. Two empty blocks match each other perfectly. */
  checkTrue('both dictionaries were actually found', keysIn(enBlock) >= 20 && keysIn(arBlock) >= 20);
  check('the two dictionaries carry the same number of keys', keysIn(arBlock), keysIn(enBlock));

  /*
   * DIRECTION IS DERIVED IN ONE PLACE. A component computing `rtl` from a
   * locale of its own is how one region stays LTR — and it is invisible in
   * every LTR screenshot anyone takes.
   */
  checkTrue('direction is a function of the locale', /function directionOf\(/.test(i18n));
  /*
   * ⚠ THE FIRST VERSION OF THIS ALSO MATCHED `=== 'ar'` AND FAILED THE SHELL,
   * WHICH WAS CORRECT CODE. The language switcher legitimately names locales;
   * it does not decide direction. **"Mentions a locale" was a PROXY for
   * "computes a direction", and the proxy caught the wrong thing.**
   *
   * Narrowed to the literals that only `directionOf` may produce. A component
   * writing `'rtl'` for itself is the real hazard: it is invisible in every
   * LTR screenshot anyone takes, and it leaves one region unflipped.
   *
   * **The shell was then changed rather than exempted** — the switcher's
   * `code === 'ar' ? … : …` became a `Record<Locale, MessageKey>` lookup, so
   * the finding was half a false positive and half a real duplicate list.
   */
  const dirDeciders = readdirSync(join(import.meta.dirname, '..', 'src'), { recursive: true })
    .filter((name) => typeof name === 'string' && /\.tsx?$/u.test(name))
    .filter((name) => name !== 'lib/i18n.tsx')
    .filter((name) =>
      /['"]rtl['"]/u.test(
        strip(readFileSync(join(import.meta.dirname, '..', 'src', name), 'utf8')),
      ),
    );
  check('nothing outside lib/i18n.tsx computes a direction', dirDeciders.join(','), '');

  /*
   * A MISSING TRANSLATION MUST NOT FALL BACK TO ENGLISH. The fallback is what
   * makes a half-translated console look finished, and it is one `??` away.
   */
  check('the lookup has no English fallback', /DICTIONARIES\[locale\]\[key\]\s*\?\?/.test(i18n), false);

  /*
   * =========================================================================
   * HOW MUCH IS STILL ENGLISH, AS A PINNED NUMBER
   * =========================================================================
   *
   * **The dictionary being COMPLETE is enforced by the compiler. This measures
   * something different: how much of the console has not been ROUTED THROUGH
   * the dictionary yet** — a literal in a screen is invisible to `tsc`, because
   * a hard-coded English string is perfectly valid TypeScript.
   *
   * **Without a number here, "the copy pass is progressing" is a claim nobody
   * can check**, and a green gate would say the translation is done.
   *
   * TWO POPULATIONS, KEPT APART BECAUSE THEY DIFFER IN CONSEQUENCE:
   *
   *   ATTRIBUTES — `aria-label`, `label`, `hint`, `placeholder`, `title`. **The
   *     highest-consequence class.** A heading left in English is read by
   *     someone who can see the Arabic around it; **an `aria-label` left in
   *     English is the ONLY thing a screen-reader user has**, navigating by
   *     landmark and control name with no surrounding context.
   *
   *   PROSE — JSX text nodes. A rougher measure: separating a sentence from an
   *     identifier, a status token or a unit needs judgement a regex has not
   *     got, so this is an INDICATOR rather than a verdict. **Named as such so
   *     nobody reports it as precise.**
   *
   * **BOTH ARE PINNED AND BOTH FAIL IN BOTH DIRECTIONS**, exactly as
   * `check:source-bytes` does. MORE is a regression — someone added an English
   * literal. FEWER means the copy pass moved and the pin must come down in that
   * same change. **A number that can only be edited deliberately is a number
   * somebody has to look at** (`§11a`), and a pin that only ever ratchets
   * downward silently would let the work stall without anyone noticing.
   */
  /*
   * ⚠ THE DICTIONARY ITSELF IS EXCLUDED, AND IT IS ONE NAMED FILE RATHER THAN A
   * PATTERN. Excluding anything from a coverage check is the highest-suspicion
   * change there is (`§11a`), so the reason is here and the skip is enumerated.
   *
   * **`lib/i18n.tsx` IS the translation.** Every string in it is type-guaranteed
   * to have an Arabic counterpart — `Record<MessageKey, string>` — which is a
   * stronger guarantee than this pin gives anything else. Counting it as
   * *untranslated prose* is a category error.
   *
   * **AND IT WAS INVERTING THE PIN.** The prose pattern reads `}` … text … `{`,
   * so a translated string carrying a placeholder — *"…at most {max} characters.
   * This one is {length}."* — matches as a JSX text node. **The count went UP by
   * two when I translated four more field refusals**, which is the opposite of
   * what the number means and would have read as a regression.
   *
   * It was found by the pin going red in the wrong direction, not by review.
   */
  const DICTIONARY = 'lib/i18n.tsx';
  const tsxFiles = readdirSync(join(import.meta.dirname, '..', 'src'), { recursive: true })
    .filter(
      (name) => typeof name === 'string' && /\.tsx$/u.test(name) && name !== DICTIONARY,
    );
  const HUMAN_ATTRS = /\b(aria-label|label|hint|title|placeholder|retryLabel|targetHeading)="([^"]+)"/gu;

  /*
   * ⚠ THE PROSE PATTERN WAS UNDER-COUNTING FROM THE DAY IT WAS WRITTEN, AND
   * EVERY FIGURE REPORTED FROM IT WAS A LOWER BOUND RATHER THAN A MEASURE.
   * Corrected 2026-09-11.
   *
   * It was `/>\s*(text)\s*</` — **text between two TAGS, on ONE line.** Real
   * JSX prose is neither:
   *
   *   </span>{' '}
   *   A verification attests to one specific number, so it cannot follow this
   *   one — the tick below has been removed.{' '}
   *
   * **That sentence begins after an INTERPOLATION, spans THREE LINES, and ends
   * at another interpolation.** The old pattern could not see any of those
   * three things, and it is exactly the shape a long explanatory warning takes
   * — which is to say, the shape that carries the most meaning.
   *
   * **Measured on the same tree: 118 by the old pattern, 142 by this one.**
   * So roughly a sixth of the remaining work was invisible to the instrument
   * reporting it, and the instrument was mine.
   *
   * **This is `§11a`'s "a floor proves the check found SOMETHING, not
   * EVERYTHING", turned on my own coverage metric** — the CSS check that saw
   * 106 of 243 candidates is the same defect, and I wrote this one after
   * reading that story.
   *
   * The pattern now allows `}` as an opener, `{` as a terminator, and
   * whitespace inside the run so a sentence may wrap. `KEYWORDS` and the
   * three-word floor keep TypeScript declarations out — `interface Draft {`
   * matches the shape otherwise.
   */
  /*
   * ⚠ THE THREE-WORD FLOOR HID EVERY COLUMN HEADER AND THREE PAGINATION LINES,
   * AND I REPORTED THE PASS COMPLETE ON THE NUMBER IT PRODUCED.
   *
   * The pattern required **eleven characters and three words**. So `Operators`,
   * `Status`, `Created`, `Members`, `Identifier`, `Granted`, `First page`,
   * `Remove authority`, `Edit`, `Cancel`, `Name`, `Menu`, `Correlation` and
   * **three `Showing N …` plural ternaries** were never in the population —
   * **32 nodes, on the text a reader meets FIRST on every table.**
   *
   * **The floor was doing a real job**: `interface Draft {` matches the shape,
   * and a prose count full of TypeScript declarations is a count nobody reads.
   * It was also excluding the most-read text on every screen. `§11a`'s *a floor
   * proves the check found SOMETHING, not EVERYTHING* — third instrument this
   * session whose population was smaller than the thing it reported on.
   *
   * **THE REPAIR IS A LONGER KEYWORD LIST, NOT A LOWER FLOOR ALONE.** Dropping
   * to one word without it floods the count with `Promise`, `ReactNode` and
   * every type name in a generic position. The two-list shape is deliberate:
   * **what is EXCLUDED is enumerated**, so a construct this cannot classify
   * counts as prose and shows up, rather than being silently skipped.
   *
   * **THE EXEMPTIONS ARE ALL PROPER NOUNS OR KEYWORDS, AND EACH IS NAMED:**
   *
   *   `Dudo`        the product's name, identical in both languages
   *   `UTC`         the timezone's name. The audit filters say `(UTC)` in both
   *                 languages and an operator comparing this to an ISO
   *                 timestamp needs the same three letters in both places
   *   `try`         the JavaScript keyword, in `main.tsx`'s bootstrap
   *   `permission`  `{permission}` — a rendered Core permission token, which is
   *                 a wire identifier and must not be translated
   *
   * **Enumerating them is the point.** A skip must be named (`§11a`), and the
   * alternative — a floor high enough to hide four false positives — is what
   * hid thirty-two real ones.
   */
  const PROSE = /[>}]\s*([A-Za-z][A-Za-z\s,.'’—–\-]{2,}?)\s*[<{]/gu;
  const KEYWORDS =
    /^(interface|function|const|let|type|export|import|return|if|for|while|class|enum|declare|async|await|new|throw|catch|switch|case|default|void|readonly|else|true|false|null|undefined|string|number|boolean|Promise|ReactNode|ReactElement|Record|Readonly|Partial|Array|Set|Map|try|Dudo|UTC|permission)\b/u;

  /*
   * ===========================================================================
   * ⚠ AND A THIRD POSITION, FOUND AFTER THE SECOND ZERO: STRINGS IN JSX
   * EXPRESSIONS
   * ===========================================================================
   *
   * `PROSE` reads TEXT NODES. **Nineteen operator-facing strings lived in
   * ternaries and template literals inside `{…}`** — `'No more pages' :
   * 'Next page'`, `'Saving…' : 'Save changes'`, three create-failure headlines,
   * and two plural constructions — and none of them was ever in any count.
   *
   * **Two were absence claims the ABSENCE CHECK could not see either**:
   * *"There are no Organizations yet."* and *"No business types yet."* That
   * check scans the dictionary, so **a string has to be translated before it
   * can be examined** — which means the two instruments share one blind spot
   * rather than covering for each other. `§11a`'s *two checks built to
   * complement each other can share a blind spot, which their complementarity
   * hides.*
   *
   * `EXPRESSION_PROSE` closes it: a quoted literal in a ternary arm or a
   * template literal, capitalised, containing a space. **Capitalised and
   * multi-word** keeps class names, ids and keys out without a length floor —
   * the mistake that hid thirty-two nodes the first time.
   */
  const EXPRESSION_PROSE =
    /[?:]\s*'([A-Z][A-Za-z][^']*\s[^']*)'|`([A-Z][A-Za-z][^`]*\s[^`]*)`/gu;

  let untranslatedAttrs = 0;
  let untranslatedProse = 0;
  for (const name of tsxFiles) {
    const source = strip(readFileSync(join(import.meta.dirname, '..', 'src', name), 'utf8'));
    untranslatedAttrs += [...source.matchAll(HUMAN_ATTRS)].length;
    untranslatedProse += [...source.matchAll(EXPRESSION_PROSE)]
      .map((match) => (match[1] ?? match[2]).replace(/\s+/gu, ' ').trim())
      /*
       * A TEMPLATE LITERAL WITH AN INTERPOLATION IS USUALLY CODE — a URL, a
       * className, an id. One carrying real prose is caught by the text-node
       * pattern where it is rendered, or by this one where it is not.
       */
      .filter((value) => !value.includes('${') && !KEYWORDS.test(value)).length;
    untranslatedProse += [...source.matchAll(PROSE)]
      .map((match) => match[1].replace(/\s+/gu, ' ').trim())
      /*
       * ONE WORD IS ENOUGH TO BE OPERATOR-FACING. `Status` is a column header a
       * reader meets before any row; the previous `>= 3` excluded it and
       * everything like it. The KEYWORDS list is what keeps declarations out
       * now — see the pattern's comment for why that swap is the repair.
       */
      .filter((value) => !KEYWORDS.test(value) && value.split(' ').length >= 1).length;
  }

  console.log(
    `  … still English: ${String(untranslatedAttrs)} human-read attribute(s) · ` +
      `${String(untranslatedProse)} prose node(s), across ${String(tsxFiles.length)} .tsx files`,
  );
  /* The floor: zero files examined would report a perfect score. */
  checkTrue('the copy-coverage scan reached the tree', tsxFiles.length >= 20);
  /*
   * AND THE EXCLUSION IS ITSELF FLOORED. If `lib/i18n.tsx` is ever renamed or
   * moved, `name !== DICTIONARY` silently stops excluding anything and the pin
   * jumps by however many placeholders the dictionary happens to carry — a
   * confusing red that reads as a regression in the copy work. This turns that
   * into a red that names the cause.
   */
  checkTrue(
    'the excluded dictionary is where the exclusion thinks it is',
    readdirSync(join(import.meta.dirname, '..', 'src'), { recursive: true }).includes(DICTIONARY),
  );
  /*
   * PIN HISTORY, kept because the direction of travel is the useful part:
   *   54 / — …… before the copy pass began
   *   41 / 140 …… after accessible names and loading labels
   *   40 / 137 …… after the Template-reach notice and the two field hints
   *   40 / 142 …… ⚠ PROSE PATTERN CORRECTED — the number went UP because the
   *                 instrument improved, not because the work went backwards.
   *                 The Organization-identity pass landed in the same change
   *                 and is why it is 142 rather than higher.
   *   38 / 117 …… after `ResetCredential.tsx` — 39 new message keys, both
   *                 languages. **Two attributes and TWENTY-FIVE prose nodes**,
   *                 which is the ratio to expect from here: the attributes were
   *                 mostly done first and what is left is explanatory copy.
   *   32 /  89 …… after `OnboardOrganization.tsx` — 55 new keys, plus three
   *                 renamed out of `signIn.*` into `derivation.*` when this
   *                 screen became their second consumer.
   *   14 /  70 …… after BOTH audit feeds and `api/audit-window.ts`.
   *   14 /  69 …… after `api/errors.ts` and `api/platform.ts`'s four field
   *                 refusals — **27 more operator-facing sentences, and only
   *                 ONE of them moved this figure**, because both modules are
   *                 `.ts`. The single point came from excluding the dictionary
   *                 (see above), not from the copy work.
   *
   * ⚠ **THAT ROW IS THE CLEAREST STATEMENT OF THIS PIN'S LIMIT THERE IS.** A day
   * that translated the error envelope, the audit window and every field
   * refusal in the console moved the reported number by one. **Read it as
   * "English left in JSX", never as "how much translation remains".**
   *
   *   10 /  60 …… after `ConfirmationGate.tsx` — the confirmation chrome, NOT
   *                 the statement, which is Core's and is rendered verbatim in
   *                 whatever language it arrives in.
   *    9 /  47 …… after `OrganizationIdentity.tsx`, including the two registry
   *                 names, which are institutions rather than phrases.
   *    6 /  37 …… after `OrganizationDetail.tsx`.
   *    3 /  19 …… after `Operators.tsx` and `Templates.tsx`. **The three
   *                 remaining attributes are wire identifiers** — two action-id
   *                 placeholders and a target column — see below.
   *    3 /   0 …… ✅ **THE PROSE COUNT IS AT ZERO.** Every JSX text node this
   *                 pattern can see is now a message key.
   *
   * ===========================================================================
   * ⚠ ZERO IS NOT "DONE", AND THIS PARAGRAPH EXISTS SO NOBODY READS IT AS DONE
   * ===========================================================================
   *
   * **This pin has always measured English left in JSX. It has never measured
   * translation.** The day it reached zero, roughly forty operator-facing
   * sentences had already been translated in `.ts` modules it does not scan —
   * the error envelope, the audit window, the field refusals — **and moving
   * every one of them changed this number by one.**
   *
   * **What ZERO means:** no `.tsx` file holds a text node this pattern
   * recognises.
   *
   * **What it does NOT mean:** that the console is fully translated (a `.ts`
   * string is invisible here), that the Arabic is correct (nothing checks
   * meaning), or that it renders correctly in RTL (nothing here has ever
   * rendered anything).
   *
   * **AND A PIN AT ZERO STOPS BEING A RATCHET.** Its whole value was that it
   * only moved down and a human had to move it. At zero it is a REGRESSION
   * DETECTOR — any new English prose goes red — which is a different and
   * narrower instrument, and the one that matters from here.
   *
   * THE ATTRIBUTE FLOOR IS 3, NOT 0, AND IT IS DELIBERATE:
   *
   *   2 × `placeholder="platform.…"`   action-id examples an operator types
   *                                    VERBATIM into a filter. A localised
   *                                    example is an example that does not work.
   *   1 × `targetHeading="Organization"` on the dashboard — **FIXED in the same
   *                                    pass that wrote this paragraph.** It was
   *                                    an oversight, not a decision, and writing
   *                                    down which of the three were deliberate
   *                                    is what surfaced that one was not.
   *
   *    2 /   0 …… ✅ **BOTH PINS ARE AT THEIR FLOOR.** The two survivors are
   *                 action-id placeholders, and they are the correct answer
   *                 rather than remaining work.
   *
   * **THAT IS THE WHOLE VALUE OF ENUMERATING A RESIDUAL RATHER THAN STATING
   * ITS SIZE.** "Three attributes remain" is a number nobody can act on; naming
   * all three found that one of them was a defect.
   *
   *    2 /   0 …… ⚠ **RE-MEASURED WITH A ONE-WORD FLOOR. The previous zero was
   *                 a fact about a THREE-WORD MINIMUM, not about the console.**
   *
   * ===========================================================================
   * ⚠ THE FIRST ZERO WAS REPORTED AS A COMPLETED PASS AND THIRTY-TWO NODES
   * WERE STILL ENGLISH
   * ===========================================================================
   *
   * The prose pattern required **three words**. Every column header
   * (`Status`, `Created`, `Identifier`, `Members`, `Operator`, `Correlation`),
   * every short button (`Edit`, `Cancel`, `Menu`, `First page`,
   * `Remove authority`), the `You` badge, the `at the time` role qualifier and
   * **three `Showing N …` plural ternaries** were below it.
   *
   * **Those are the most-read strings on the console** — a table header is read
   * before any row in the table — and the pin said zero.
   *
   * **THE SECOND ZERO IS A DIFFERENT AND STRONGER CLAIM**: one-word floor,
   * declarations excluded by an enumerated keyword list rather than by length,
   * four proper-noun exemptions named individually. It can still only see
   * `.tsx` text nodes — that limit is unchanged and is stated above.
   *
   * **The lesson is the one this file keeps recording about itself: a floor
   * proves the check found SOMETHING, not EVERYTHING — and a floor tuned to
   * exclude noise excludes signal of the same shape.**
   *
   *    2 /   1 …… ⚠ **A THIRD POSITION, FOUND AFTER THE SECOND ZERO.** Nineteen
   *                 strings lived in TERNARIES AND TEMPLATE LITERALS inside
   *                 `{…}` — a syntactic position neither previous version read.
   *                 `EXPRESSION_PROSE` now covers it. **The 1 is `main.tsx`'s
   *                 bootstrap failure, pinned rather than exempted** — see the
   *                 check.
   *
   * **FOUR INSTRUMENTS IN ONE SESSION TURNED OUT TO HAVE POPULATIONS SMALLER
   * THAN THE THING THEY REPORTED ON**: the `.tsx`-only scan, the five-file label
   * list, the three-word floor, and the text-node-only position. **Every one was
   * green throughout, and none could have gone red about the half it could not
   * see.**
   *
   * **And the two copy instruments share a blind spot rather than covering for
   * each other**: the absence check scans the DICTIONARY, so **a string must be
   * translated before it can be examined for absence claims** — two of the
   * nineteen were live "yet" claims that had escaped both. `§11a`'s *two checks
   * built to complement each other can share a blind spot, which their
   * complementarity hides.*
   *
   * ⚠ **AND THE NUMBERS ABOVE HAVE ALWAYS EXCLUDED `.ts` MODULES.** The scan
   * walks `.tsx` files. `api/audit-window.ts` was returning FIVE operator-facing
   * English sentences and `describeWindowRefusal` six more, none of which was
   * ever in this population — and `api/errors.ts` and `api/platform.ts` hold
   * roughly thirty more that still are not. **A measured ~40 operator-facing
   * strings sit outside every figure this pin has ever reported.**
   *
   * The pin is left scoped to `.tsx` deliberately rather than widened in the
   * same breath: a `.ts` module's string literals are a mixture of operator copy
   * and deployment diagnostics (`config.ts` throws at startup for a bad env var;
   * that must stay English), and a pattern that cannot tell them apart would
   * report a number nobody could act on. **What is not acceptable is the gap
   * being invisible**, so it is stated here and in the report rather than
   * silently carried.
   *
   * **The attribute figure is unaffected** — attributes are unambiguous and
   * that pattern was never in doubt. **Only the prose count was wrong**, and
   * only in the reassuring direction.
   *
   * **Both pins move DOWN and the run goes red to say so**, which is the
   * mechanism rather than an inconvenience: a pin that only ratcheted silently
   * would let the work stall with nobody noticing. **And a pin that moves UP
   * because a measurement was corrected must be recorded as exactly that**, or
   * the history reads as a regression.
   */
  /*
   * ⚠ BOTH PINS ARE NOW AT THEIR FLOOR, AND THEY HAVE CHANGED INSTRUMENT.
   *
   * They were RATCHETS: only ever moved down, by a human, deliberately. At the
   * floor they are **REGRESSION DETECTORS** — any new English prose or
   * human-read attribute goes red.
   *
   * **`2` IS THE CORRECT VALUE, NOT A REMAINDER.** Both survivors are action-id
   * placeholders an operator types verbatim into a filter; a localised example
   * is an example that does not work. **A future reader must not "finish the
   * job" by keying them** — see the pin history above for which two and why.
   */
  /*
   * ⚠ THE PROSE FLOOR IS 1, NOT 0, AND IT IS PINNED RATHER THAN EXEMPTED.
   *
   * The survivor is `main.tsx`'s bootstrap failure: *"The console could not
   * start on this build."* **It fires when `LocaleProvider` failed to mount**,
   * so there is no locale, no dictionary and no `t` — reaching for one there
   * would throw inside the handler for a throw.
   *
   * **Pinned rather than exempted, deliberately.** An exemption hides it and
   * reads as settled; a pin of 1 keeps it in the count, states why, and **goes
   * red the day a SECOND untranslatable string appears** — which is the event
   * worth catching, because the second one probably can be translated.
   */
  check('untranslated human-read attributes, against the pin', untranslatedAttrs, 2);
  check('untranslated prose nodes, against the pin', untranslatedProse, 1);

  /*
   * =========================================================================
   * A SENTENCE TWO SCREENS SHARE LIVES UNDER ONE KEY, AND THE FORK MAY NOT
   * COME BACK
   * =========================================================================
   *
   * `measuring`, `remainingPrefix` and `estimateNote` were `signIn.*` until
   * `OnboardOrganization` became their second consumer. They are now
   * `derivation.*`.
   *
   * **THE TYPE COVERS THE RENAME AND NOT THE RE-FORK.** A consumer left on the
   * old key does not compile, so the migration is self-enforcing. What nothing
   * refuses is a third screen adding `audit.measuring` with the same sentence
   * in it — which compiles, renders identically, and drifts the day one of them
   * is reworded. `§2b`: *when a guarantee moves from a test into the file
   * layout, the assertion moves with it*, and here the guarantee is that one
   * sentence has one home.
   *
   * **This is a RESERVATION on the old names**, scoped to the namespace rather
   * than to today's three keys — a check listing the exact keys would be
   * correct now and silently wrong the first time a fourth was shared.
   *
   * ⚠ **THIS CHECK EXISTS BECAUSE A NEGATIVE CONTROL HAD NOTHING TO CONTROL.**
   * I wrote the control first, it fired, and then I noticed it was proving a
   * property no check asserted — the second time in one session that writing a
   * control reached a guarantee nobody had encoded. The control is the reason
   * this is here; on its own it would have been a green line about nothing.
   */
  check(
    'the shared derivation copy is not re-forked into a screen namespace',
    /'(signIn|audit|onboard|reset)\.(measuring|remainingPrefix|estimateNote)'/.test(i18n),
    false,
  );

  /*
   * =========================================================================
   * ⚠ NO `Intl` CALL MAY TAKE THE BROWSER'S LOCALE INSTEAD OF THE CONSOLE'S
   * =========================================================================
   *
   * `toLocaleDateString(undefined, …)` reads the BROWSER's language. An operator
   * who switched this console to Arabic saw Arabic everywhere **except the
   * dates**, which stayed in whatever their browser was set to.
   *
   * **THERE WERE EIGHT AND I REPORTED TWO.** I fixed `describeWindow` and
   * `ExpiresAt`, then told the Team Lead the class was closed — **a confident
   * negative composed from what I remembered fixing rather than from an
   * enumeration.** The sweep that found the other six ran after the claim. That
   * is `§11a`'s *to assert a negative about what you own, ENUMERATE rather than
   * filter for what you expect*, arriving in a report rather than in a `ps`.
   *
   * **This exists because the class is invisible in testing**: an
   * English-reading developer's browser and console agree by default, so every
   * one of the eight rendered correctly for everybody who looked at them. Only
   * the operator who deliberately switched ever saw it — the operator the whole
   * copy pass exists for.
   *
   * The pattern is deliberately the crude one: **any `toLocale*` whose first
   * argument is `undefined` or absent.** A formatter that genuinely wants the
   * browser's preference does not exist in this console and would need a
   * sentence here saying why.
   *
   * ---------------------------------------------------------------------------
   * ✅ AND THE BROKEN STATE WAS RECOVERED AFTER ALL — 8 of 8, ON A REAL CORPUS
   * ---------------------------------------------------------------------------
   *
   * I wrote here that the free failing input was destroyed by fixing before
   * checking. **It was recoverable read-only**: nothing in this session is
   * committed, so `git show HEAD:<path>` reconstructs every file as it stood
   * before any of today's work — no `stash`, no `checkout`, no branch switch,
   * and nothing written into a tree three other agents are using.
   *
   * Run against `HEAD` (`f225f1a`), 37 files, 8 `toLocale*` calls:
   *
   * ```
   * api/audit-window.ts                    toLocaleDateString(undefined,
   * components/AuditRecordList.tsx         toLocaleString(undefined,
   * components/ConfirmationGate.tsx        toLocaleTimeString(undefined,
   * components/OrganizationIdentity.tsx    toLocaleDateString(undefined,
   * screens/Operators.tsx                  toLocaleDateString(undefined,
   * screens/OrganizationDetail.tsx         toLocaleDateString(undefined,
   * screens/Organizations.tsx              toLocaleDateString(undefined,
   * screens/Templates.tsx                  toLocaleDateString(undefined,
   * ```
   *
   * **8 of 8, and 8 of 8 formatting calls — so every date in this console read
   * the browser's locale, and none was introduced by today's work.** The class
   * predates the session entirely.
   *
   * **That is worth more than the constructed fixture and for a reason the
   * fixture cannot supply: the counts MATCH.** Eight found, eight fixed, eight
   * formatting calls total — so there was no ninth hiding in a shape I did not
   * predict. **A fixture can only confirm the shapes its author thought of; a
   * real corpus can tell you the set is closed.**
   */
  const localeBlind = [];
  for (const name of readdirSync(join(import.meta.dirname, '..', 'src'), { recursive: true })) {
    if (typeof name !== 'string' || !/\.tsx?$/u.test(name)) continue;
    const source = strip(readFileSync(join(import.meta.dirname, '..', 'src', name), 'utf8'));
    for (const match of source.matchAll(/\.toLocale[A-Za-z]*\(\s*(undefined\s*[,)]|\))/gu)) {
      localeBlind.push(`${name}:${match[0].replace(/\s+/gu, '')}`);
    }
  }
  /*
   * A FLOOR ON THE READER, not only on the result. A regex that matched nothing
   * because the call shape changed would report a clean sweep — so this asserts
   * the scan can still SEE `toLocale` calls at all, and prints how many.
   */
  const localeAware = [
    ...readdirSync(join(import.meta.dirname, '..', 'src'), { recursive: true }),
  ].filter((name) => typeof name === 'string' && /\.tsx?$/u.test(name))
    .reduce(
      (total, name) =>
        total +
        [
          ...strip(
            readFileSync(join(import.meta.dirname, '..', 'src', name), 'utf8'),
          ).matchAll(/\.toLocale[A-Za-z]*\(/gu),
        ].length,
      0,
    );
  console.log(`  … ${String(localeAware)} Intl formatting call(s) found in the tree`);
  checkTrue('the locale scan found formatting calls at all', localeAware >= 6);
  check('no formatter falls back to the browser locale', localeBlind.join(' | '), '');
  checkTrue(
    'and it lives under derivation.*',
    /'derivation\.measuring':/.test(i18n) &&
      /'derivation\.remainingPrefix':/.test(i18n) &&
      /'derivation\.estimateNote':/.test(i18n),
  );

  /*
   * =========================================================================
   * NO OPERATOR-FACING COPY MAY CLAIM A CAPABILITY DOES NOT EXIST
   * =========================================================================
   *
   * **A notice reading "Nothing consumes a Template… onboarding adds the
   * reference, and it is being built now" sat on this console for days after
   * onboarding was built.** Nothing went red. `workflow.md` §12's amendment
   * says why: *a sentence about a missing capability outlives the capability
   * arriving, because everyone who quotes it is quoting it for the half that is
   * still true.*
   *
   * **AND IT PROPAGATED.** I read that notice while building the dashboard,
   * believed it, wrote it into the dictionary and translated it into Arabic —
   * so one stale claim acquired a second screen and a second language before
   * anyone checked it. Two more instances were live in FIELD HINTS: *"It cannot
   * be changed later"* on the Template name and *"It cannot be changed
   * afterwards"* on the business type, both read at the moment a decision is
   * made, both making a reversible choice look permanent.
   *
   * **THIS CHECKS THE DICTIONARY, NOT THE COMMENTS**, and the distinction is
   * the point: a stale comment misleads the next author, **a stale MESSAGE
   * misleads the operator.** Comments are swept by reading; this is the half
   * that can be mechanised.
   *
   * **It is a shape rule, not a word list.** Any message asserting that
   * something is absent, unbuilt, forthcoming or unchangeable is a claim that
   * expires on a date nobody schedules. **Phrase copy forward — what a thing
   * DOES and where it reaches — and it survives the capability landing.**
   */
  /*
   * ⚠ THE FIRST VERSION OF THIS PATTERN WAS BLIND TO THE SENTENCE THAT CAUSED
   * THE WHOLE FINDING, and the negative control is the only reason I know.
   *
   * It matched `not yet` as an ADJACENT PAIR. The live string was
   * *"Creating a business type does not change what any customer sees yet."* —
   * **"not" and "yet" six words apart.** So the check I wrote to catch that
   * class would have passed over the exact instance it was written for.
   *
   * **I had built the pattern from the phrases I remembered rather than from
   * the strings that were actually live**, which is `§11a`'s sound-by-accident
   * with the accident going the other way: it would have been green, and I
   * would have reported the class closed.
   *
   * **`\byet\b` ALONE is the robust form.** In operator copy "yet" is an
   * absence marker almost by definition — it exists to say *not now, later* —
   * and a false positive costs one deliberate rewording, while a false
   * negative is what has now happened four times.
   *
   * ---------------------------------------------------------------------------
   * THE ONE FALSE POSITIVE IT FOUND, AND WHY THE COPY MOVED RATHER THAN THE
   * PATTERN
   * ---------------------------------------------------------------------------
   *
   * Widening to `\byet\b` immediately caught **"None yet"** — a DATA-empty
   * state, not a capability claim. **The two are genuinely different:** a data
   * state is re-evaluated from a live query on every render and cannot go
   * stale, whereas a capability claim is a sentence the code makes about
   * itself and expires silently.
   *
   * **So the pattern was over-broad by its own stated purpose — and the copy
   * was still wrong.** *"None yet"* promises more are coming, and this console
   * has no basis for that: an empty platform may stay empty. **"None" is what
   * the query returned; "None yet" is that plus an assumption.**
   *
   * **The copy was corrected because the correction stands on its own**, not to
   * satisfy the check. Had it not — had the "yet" been carrying real meaning —
   * the right move would have been to narrow the pattern, and saying which way
   * it went matters: **bending copy to silence a check is how a check stops
   * measuring anything.**
   */
  /*
   * ---------------------------------------------------------------------------
   * ⚠ WIDENED 2026-09-11 AFTER IT MISSED A LIVE INSTANCE BY ONE WORD
   * ---------------------------------------------------------------------------
   *
   * `Templates.tsx` said **"It cannot be edited, renamed or removed
   * afterwards."** All three of those routes exist and are wired into that
   * screen — `useUpdateTemplate`, `useRetireTemplate`, `useRestoreTemplate`,
   * imported forty lines above the sentence.
   *
   * **THE PATTERN CARRIED `cannot be changed` AND THIS SAID `cannot be
   * edited`.** One word. The check written specifically to catch this class
   * passed straight over the second instance of it **in the same file whose
   * first instance it had already caught** — the Name hint, corrected, eighty
   * lines above.
   *
   * `§12`'s *budget for MORE homes than you find*, and `§11a`'s *I built the
   * pattern from the phrases I remembered rather than from the strings that
   * were live* — **the same diagnosis this check's own comment records about
   * its first version.** It has now been too narrow twice, both times by
   * enumerating verbs.
   *
   * ---------------------------------------------------------------------------
   * ⚠ AND THE WIDENING I REACHED FOR FIRST WAS WRONG. `cannot be \w+` FLAGGED
   * ELEVEN TRUE SENTENCES.
   * ---------------------------------------------------------------------------
   *
   * *"cannot be recovered"* (a password shown once), *"cannot be longer than
   * {max}"*, *"cannot be empty"*, *"cannot be reused"*, *"cannot be undone from
   * here"* — **every one of those is true, load-bearing, and would have to be
   * reworded to satisfy a check that is wrong about them.** `§11a`: *a suite
   * that goes red under load teaches a team to ignore red*, and eleven false
   * positives would see this switched off inside a week.
   *
   * **SO I HAVE NOW DEMONSTRATED BOTH FAILURE MODES OF THIS CHECK IN ONE
   * SITTING** — too narrow to see the live defect, then too broad to be kept.
   *
   * **THE LIMIT, STATED RATHER THAN PAPERED OVER: a regex cannot separate these
   * two classes, because the difference is not in the words.**
   *
   *   *"It cannot be edited"*     a claim about a CAPABILITY, which the day a
   *                               route lands becomes false with nothing moving
   *   *"It cannot be recovered"*  a claim about an ACT that is irreversible,
   *                               which stays true
   *
   * Identical grammar. **The first expires because the world changed; the
   * second describes the world.** No pattern over the sentence can tell them
   * apart, and `§11a` is explicit that the answer to that is *a recorded
   * judgement per near-miss, not a looser comparison*.
   *
   * **So the pattern stays narrow and enumerated, with the two verbs that were
   * actually live added** — and the real control for stale capability claims is
   * the sweep `§12` prescribes when a capability ARRIVES, not this check. This
   * catches the phrasings we have met. It will not catch the next new one, and
   * saying so is better than a check that is trusted to.
   */
  const ABSENCE_CLAIMS =
    /\b(yet|nothing consumes|is being built|cannot be (changed|edited|renamed)|coming soon|inert|no route sets|forever)\b/iu;
  const dictionaryStrings = [...i18n.matchAll(/^\s{2}'[\w.]+':\s*\n?\s*'([^']*)'/gmu)].map(
    (match) => match[1],
  );
  console.log(
    `  … ${String(dictionaryStrings.length)} dictionary string(s) scanned for absence claims`,
  );
  /* A floor: zero strings would pass this perfectly. */
  checkTrue('the dictionary scan found strings', dictionaryStrings.length >= 40);
  check(
    'no operator-facing message claims a capability is absent or unchangeable',
    dictionaryStrings.filter((value) => ABSENCE_CLAIMS.test(value)).join(' | '),
    '',
  );
}
checkTrue('the skip link exists', /skip-link/.test(shell));
checkTrue('the drawer toggle reports its state', /aria-expanded=\{drawerOpen\}/.test(shell));
checkTrue('and what it controls', /aria-controls=\{drawerId\}/.test(shell));
checkTrue('the open section is marked for a screen reader', /aria-current=/.test(shell));
checkTrue('Escape closes the drawer', /key === 'Escape'/.test(shell));
checkTrue('focus returns to the toggle on close', /menuButtonRef\.current\?\.focus\(\)/.test(shell));

/*
 * DECORATIVE GRAPHICS MUST NOT BE ANNOUNCED. Every inline SVG in this console is
 * decorative — the control it sits in always carries its own text.
 */
{
  const withSvg = ['AdminShell.tsx'].map((n) =>
    readFileSync(join(import.meta.dirname, '..', 'src', 'components', n), 'utf8'),
  );
  withSvg.push(readScreen('OrganizationAudit.tsx'));
  let svgCount = 0;
  let hiddenCount = 0;
  for (const source of withSvg) {
    for (const tag of source.matchAll(/<svg[\s\S]*?>/g)) {
      svgCount += 1;
      if (/aria-hidden="true"/.test(tag[0])) hiddenCount += 1;
    }
  }
  check(`all ${String(svgCount)} inline SVGs are aria-hidden`, hiddenCount, svgCount);
}

/*
 * THE SPINNER IS DECORATIVE TOO — `busy` already changes the button's text, so
 * announcing the spinner would repeat it.
 */
checkTrue('the button spinner is aria-hidden', /aria-hidden="true"[\s\S]{0,120}animate-spin/.test(strip(buttonSource)));

console.log('\n=== Every form control has a programmatic label ===\n');

/*
 * `Field` wires `<label for>`, `aria-describedby` and `aria-invalid` together,
 * so a control rendered through it cannot be unlabelled. The check is that
 * nothing bypasses it.
 */
// `Field` moved to `@dudo/ui` with the button — see the note above.
const fieldSource = strip(
  readFileSync(
    join(import.meta.dirname, '..', '..', '..', 'packages', 'ui', 'src', 'field.tsx'),
    'utf8',
  ),
);
checkTrue('Field renders a real <label for>', /<label\s+htmlFor=\{id\}/.test(fieldSource));
checkTrue('Field joins hint and error into aria-describedby', /aria-describedby/.test(fieldSource));
checkTrue('Field sets aria-invalid only when there is an error', /'aria-invalid':\s*error\s*\?/.test(fieldSource));

/*
 * ===========================================================================
 * ⚠ THIS WALKED A HAND-WRITTEN LIST OF FIVE FILES. THE TREE HAS TEN.
 * ===========================================================================
 *
 * It named `SignIn`, `Templates`, `PlatformAudit`, `OrganizationAudit` and
 * `ResetCredential` — **and `ResetCredential` has no form controls at all**,
 * while `ConfirmationGate`, `OrganizationIdentity`, `OnboardOrganization`,
 * `OrganizationDetail` and `LocaleSwitch`, which do, were not in it.
 *
 * **So the population was drawn from the files somebody was thinking about when
 * they wrote the check** — `§11a`'s recurring shape, and the one that produces
 * a green that is a fact about the list rather than about the console. **Half
 * the form controls in this console have never been in this check's view.**
 *
 * It is now DERIVED: every `.tsx` in the tree, with the population printed. The
 * two legitimate exceptions are ENUMERATED rather than defaulted, because
 * `§11a` is explicit that a skip must be named — *"require the skip to be
 * enumerated, not defaulted, which is what a two-list classifier does and a
 * one-list one cannot."*
 */
{
  /*
   * EXCEPTION 1 — LABELLED BY WRAPPING, NOT BY `Field`. `LocaleSwitch` puts its
   * `<select>` inside a `<label>` carrying an `sr-only` caption. That is a real
   * programmatic label; `Field` is one way to get one, not the only way.
   *
   * EXCEPTION 2 — `AdminField.tsx` IS the wrapper's definition, so it contains a
   * `<Field>` and no controls.
   */
  const LABELLED_BY_WRAPPING = new Set(['components/LocaleSwitch.tsx']);
  const WRAPPER_DEFINITION = new Set(['components/AdminField.tsx']);

  let totalControls = 0;
  let totalFields = 0;
  let totalRaw = 0;
  const unbalanced = [];
  const files = readdirSync(join(import.meta.dirname, '..', 'src'), { recursive: true }).filter(
    (name) => typeof name === 'string' && /\.tsx$/u.test(name),
  );
  for (const name of files) {
    const source = strip(readFileSync(join(import.meta.dirname, '..', 'src', name), 'utf8'));
    const controls =
      (source.match(/<Input\b/gu) ?? []).length + (source.match(/<select\b/gu) ?? []).length;
    const fields = (source.match(/<Field\b/gu) ?? []).length;
    /*
     * RAW `<input>` IS COUNTED SEPARATELY AND NOT REQUIRED TO HAVE A `Field`.
     * The three in `OrganizationIdentity` are radios and checkboxes sitting
     * INSIDE a `<label>` — the label wraps the control, which is the other
     * correct way to get a programmatic name. They are asserted below.
     */
    totalRaw += (source.match(/<input\b/gu) ?? []).length;
    if (controls === 0) continue;
    totalControls += controls;
    totalFields += fields;
    if (LABELLED_BY_WRAPPING.has(name) || WRAPPER_DEFINITION.has(name)) continue;
    if (fields < controls) unbalanced.push(`${name}: ${String(controls)} control(s), ${String(fields)} Field(s)`);
  }

  console.log(
    `  … ${String(totalControls)} form control(s) and ${String(totalRaw)} raw <input>(s) ` +
      `across ${String(files.length)} .tsx files`,
  );
  /*
   * THE FLOOR. A walk that found nothing would report perfect labelling — and
   * the hand-written list this replaced was a floor of five files that could
   * never notice the other five.
   */
  checkTrue('the form-control scan reached the tree', totalControls >= 15 && files.length >= 20);
  check('every form control is wrapped by a Field', unbalanced.join(' | '), '');

  /*
   * AND THE EXCEPTIONS ARE ASSERTED, NOT ASSUMED. If `LocaleSwitch` ever loses
   * its wrapping `<label>`, the exemption above would silently keep excusing an
   * unlabelled control — **a skip that outlives its reason is worse than no
   * skip**, because it reads as a considered decision.
   */
  const localeSwitch = strip(
    readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'LocaleSwitch.tsx'), 'utf8'),
  );
  checkTrue(
    'the exempted select is still inside a <label> with an accessible caption',
    /<label[\s\S]{0,400}sr-only[\s\S]{0,200}<select\b/u.test(localeSwitch),
  );
  /*
   * THE RAW CONTROLS. Every `<input>` in the tree must sit inside a `<label>`,
   * because none of them goes through `Field`. Asserted per file rather than in
   * aggregate, so a new bare one in a new file cannot hide behind the others.
   */
  const rawOffenders = [];
  for (const name of files) {
    const source = strip(readFileSync(join(import.meta.dirname, '..', 'src', name), 'utf8'));
    const raw = (source.match(/<input\b/gu) ?? []).length;
    if (raw === 0) continue;
    const wrapped = (source.match(/<label[\s\S]{0,600}?<input\b/gu) ?? []).length;
    if (wrapped < raw) rawOffenders.push(`${name}: ${String(raw)} raw, ${String(wrapped)} wrapped`);
  }
  check('every raw <input> sits inside a <label>', rawOffenders.join(' | '), '');
}

/* =========================================================================
   13. THE BOUNDED TIME WINDOW — platform-audit-read-v1, amended
   ========================================================================= */

console.log('\n=== When a window is required, per feed ===\n');

check('the maximum span is 31 days', MAX_WINDOW_DAYS, 31);

/*
 * THE TWO FEEDS DIFFER. Platform: required when actor OR action is filtered.
 * Organization: required when action is filtered; `organization_id` is EXEMPT
 * because it is a path parameter served by an index.
 */
check('no filters -> no window required', windowIsRequired({}), false);
checkTrue('an actor filter requires one', windowIsRequired({ actorPrincipalId: 'pr_a' }));
checkTrue('an action filter requires one', windowIsRequired({ actionId: 'platform.audit.list' }));
checkTrue('both together require one', windowIsRequired({ actorPrincipalId: 'a', actionId: 'b' }));
check('an empty-string filter does not count as present', windowIsRequired({ actorPrincipalId: '', actionId: '' }), false);

console.log('\n=== The local pre-check mirrors the three refusals ===\n');

const W = (since, until) => ({ since, until });

check('an unfiltered query needs no window', windowRefusal(W('', ''), false), null);
checkTrue(
  'HALF a window is refused even unfiltered — it is an unbounded walk one way',
  windowRefusal(W('2026-09-01', ''), false) !== null,
);
checkTrue('a filtered query with no window is refused', windowRefusal(W('', ''), true) !== null);
checkTrue('a filtered query with only a start is refused', windowRefusal(W('2026-09-01', ''), true) !== null);
checkTrue('a filtered query with only an end is refused', windowRefusal(W('', '2026-09-30'), true) !== null);
check('a one-day window is accepted', windowRefusal(W('2026-09-05', '2026-09-05'), true), null);
check('exactly 31 days is accepted', windowRefusal(W('2026-09-01', '2026-10-01'), true), null);
checkTrue('32 days is refused', windowRefusal(W('2026-09-01', '2026-10-02'), true) !== null);
checkTrue('an inverted window is refused', windowRefusal(W('2026-09-30', '2026-09-01'), true) !== null);

/* THE BOUNDARY, ASSERTED RATHER THAN A VALUE IN THE MIDDLE. */
check('span of a single day is 1', spanInDays(W('2026-09-05', '2026-09-05')), 1);
check('span of 1 Sep to 1 Oct is 31', spanInDays(W('2026-09-01', '2026-10-01')), 31);
check('span of 1 Sep to 2 Oct is 32', spanInDays(W('2026-09-01', '2026-10-02')), 32);
checkTrue('an inverted span is not positive', (spanInDays(W('2026-09-30', '2026-09-01')) ?? 0) <= 0);

/*
 * THE REFUSAL NAMES THE LIMIT. Safe because a span limit is a CONSTANT, not a
 * fact about data — it discloses nothing about any record, operator or
 * Organization, which is why this contract may name it while collapsing its
 * cursor rejections.
 *
 * ⚠ THIS ASSERTION CRASHED THE WHOLE SCRIPT WHEN `windowRefusal` STOPPED
 * RETURNING PROSE, AND THE CRASH IS THE MORE INTERESTING HALF.
 *
 * It read `(windowRefusal(…) ?? '').includes('31')`. The function now returns a
 * `LocalWindowRefusal` object, `.includes` is not a function, and the script
 * **died at this line** — so **every assertion below it was NOT RUN**, which is
 * a different state from failing (`workflow.md` §10). The run exited 1 and my
 * `grep '^FAIL'` showed exactly two pin failures, because **a crash produces no
 * FAIL line**. `§11a`: *the exit code is the result, and a filter that hides
 * the noise hides the crash.*
 *
 * **AND `tsc` COULD NOT HAVE TOLD ME.** The typecheck derived every consumer of
 * the changed signature — `WindowRefusal.tsx`, both audit screens — and named
 * them precisely. **This file is `.mjs`.** So `§12`'s *derive the list from the
 * tool's diagnostics* has a hole exactly the width of the untyped verification
 * script, which is the file most likely to be reaching into the module that
 * just changed.
 *
 * THE REPLACEMENT ASSERTS THE SAME PROPERTY ONE LAYER OUT: the refusal carries
 * the measured span, the DICTIONARY sentence names the limit through `{days}`,
 * and `MAX_WINDOW_DAYS` is the single source of both. The old check confirmed
 * "31" appeared in a string; this confirms the number is derived rather than
 * typed — which is the thing that was actually at risk.
 */
{
  const tooWide = windowRefusal(W('2026-09-01', '2026-12-01'), true);
  check('a too-wide window is refused as such', tooWide?.kind, 'too_wide');
  /*
   * 92, NOT 91 — measured rather than reasoned, after I predicted 91 and the
   * run said otherwise. `until` is INCLUSIVE of the whole day, so 1 Sep to
   * 1 Dec is `[1 Sep, 2 Dec)`: Sep 30 + Oct 31 + Nov 30 + Dec 1. **The
   * off-by-one is the exclusive-end convention the module's own header warns
   * about**, and I walked into it in the assertion written to pin it.
   */
  check('and the refusal carries the MEASURED span', tooWide?.span, 92);
  check('which is not the limit', tooWide?.span === MAX_WINDOW_DAYS, false);
  checkTrue(
    'the sentence names the limit through a placeholder, not a typed numeral',
    /\{days\}/.test(i18nSource.match(/'window\.local\.tooWide':\s*\n?\s*'([^']*)'/u)?.[1] ?? ''),
  );
  check(
    'and no window message hardcodes the limit as a numeral',
    [...i18nSource.matchAll(/'window\.[\w.]+':\s*\n?\s*'([^']*)'/gu)]
      .map((match) => match[1])
      .filter((value) => new RegExp(`\\b${String(MAX_WINDOW_DAYS)}\\b`, 'u').test(value))
      .join(' | '),
    '',
  );
}

console.log('\n=== The three server tokens stay distinct ===\n');

const tokenError = (issue) =>
  new ApiError({ code: 'invalid_argument', details: [{ field: 'since', issue }] });

const messages = new Set();
for (const token of ['time_window_required', 'time_window_too_wide', 'time_window_inverted']) {
  check(`${token} is recognised`, windowRefusalToken(tokenError(token)), token);
  /*
   * THE TITLES ARE NOW KEYS, so "distinct" is asserted on both halves: three
   * different keys, AND three different sentences behind them. **Keys alone
   * would pass if two of them pointed at the same wording**, which is exactly
   * the collapse this section exists to forbid — the three refusals need three
   * different actions from the operator, and one sentence cannot say which.
   */
  const described = describeWindowRefusal(token);
  const title = i18nSource.match(
    new RegExp(`'${described.titleKey.replace(/\./gu, '\\.')}':\\s*\\n?\\s*'([^']*)'`, 'u'),
  )?.[1];
  checkTrue(`${token} has its own title key`, described.titleKey.length > 0);
  checkTrue(`${token}'s title is in the dictionary`, (title ?? '').length > 0);
  messages.add(title);
}
check('the three titles are all different', messages.size, 3);
check(
  'an unrelated invalid_argument is not treated as a window problem',
  windowRefusalToken(tokenError('must_be_an_identifier')),
  null,
);

console.log('\n=== Walking backwards: the window shift ===\n');

/*
 * IT SHIFTS BY THE WINDOW'S OWN LENGTH, NOT BY A CALENDAR MONTH, and the first
 * version did the latter and produced INVALID windows: `1 Sep – 1 Oct` is 31
 * days, and one calendar month earlier is `1 Aug – 1 Sep`, which is 32 — over
 * the limit and refused by Core, reached by pressing a button this console
 * offered. Months are not a fixed length; a span limit is.
 *
 * Caught by the check below, which is why it asserts the SPAN of the result
 * rather than its dates.
 */
check(
  'shifting earlier moves both ends by the span',
  JSON.stringify(shiftWindowByOwnLength(W('2026-09-01', '2026-09-30'), -1)),
  JSON.stringify(W('2026-08-02', '2026-08-31')),
);
check(
  'and shifting later returns to where it started',
  JSON.stringify(shiftWindowByOwnLength(shiftWindowByOwnLength(W('2026-09-01', '2026-09-30'), -1), 1)),
  JSON.stringify(W('2026-09-01', '2026-09-30')),
);
check('an empty draft shifts to nothing', shiftWindowByOwnLength(W('', ''), -1).since, '');
check(
  'an inverted draft is returned untouched rather than shifted into nonsense',
  JSON.stringify(shiftWindowByOwnLength(W('2026-09-30', '2026-09-01'), -1)),
  JSON.stringify(W('2026-09-30', '2026-09-01')),
);

/*
 * THE TWO PROPERTIES THAT MAKE IT USABLE FOR AN INVESTIGATION.
 */
for (const [since, until] of [
  ['2026-09-01', '2026-10-01'],
  ['2026-01-15', '2026-02-14'],
  ['2028-02-01', '2028-02-29'],
  ['2026-09-05', '2026-09-05'],
]) {
  const original = W(since, until);
  const shifted = shiftWindowByOwnLength(original, -1);
  const originalSpan = spanInDays(original);
  const shiftedSpan = spanInDays(shifted);
  check(`${since}..${until}: the span is preserved`, shiftedSpan, originalSpan);
  checkTrue(
    `${since}..${until}: the shifted window is still legal`,
    shiftedSpan !== null && shiftedSpan >= 1 && shiftedSpan <= MAX_WINDOW_DAYS,
  );
  /*
   * CONTIGUOUS, NOT OVERLAPPING. The earlier window must end exactly one day
   * before this one starts — a gap would hide records while looking exhaustive,
   * and an overlap would double-count them.
   */
  const gapDays =
    (new Date(`${original.since}T00:00:00.000Z`).getTime() -
      new Date(`${shifted.until}T00:00:00.000Z`).getTime()) /
    86_400_000;
  check(`${since}..${until}: windows tile with no gap and no overlap`, gapDays, 1);
}

console.log('\n=== The obligation a contract cannot enforce ===\n');

/*
 * *** A CONSOLE MUST RENDER AN EMPTY WINDOWED RESULT AS "NO RECORDS IN THIS
 * WINDOW", NEVER AS "NO RECORDS". ***
 *
 * Core refuses an omitted window so an operator cannot be silently narrowed.
 * Nothing stops them MISREADING a correctly narrow one — and an investigator who
 * filters by an operator, sees an empty page and concludes "this person did
 * nothing" has drawn a conclusion the data does not support. On an evidence
 * surface that is indistinguishable from evidence of innocence.
 *
 * ASSERTED IN THE SOURCE because it is the one requirement here with no
 * server-side enforcement at all.
 */
for (const name of ['PlatformAudit.tsx', 'OrganizationAudit.tsx']) {
  const source = readScreen(name);
  /*
   * WHITESPACE IS COLLAPSED BEFORE MATCHING PROSE. JSX wraps text at arbitrary
   * points, so "were not searched" can arrive as "were not\n  searched" — which
   * is what made the first version of this check report a false failure against
   * a screen that said exactly the right thing. Any multi-word assertion about
   * rendered prose has to normalise first.
   */
  const prose = source.replace(/\s+/g, ' ');
  /*
   * ⚠ THESE TWO MATCHED ENGLISH IN THE SCREEN AND WERE BROKEN BY TRANSLATION —
   * the seventh and eighth of that shape. They are split the usual way, and
   * **this pair gets the Arabic half pinned as well**, for the same reason the
   * reset screen's hedge does: `Record<MessageKey, string>` guarantees an
   * Arabic sentence EXISTS and cannot guarantee it still says *in this window*.
   *
   * **A translation that shortened it to "no records" would compile, read
   * fluently, and reintroduce the exact defect this section exists to
   * prevent** — an investigator concluding "this person did nothing" from an
   * answer that only means "we did not look outside these dates". It is the one
   * requirement here with no server-side enforcement at all, so it does not get
   * to rest on a type that cannot see meaning.
   */
  checkTrue(
    `${name}: the empty state names the window it searched`,
    /audit\.empty\.inWindow/.test(prose),
  );
  checkTrue(
    `${name}: and states that outside it was not searched`,
    /empty\.windowNotSearched/.test(prose),
  );
  checkTrue(
    `${name}: the window is chosen by whether one was APPLIED, not by whether filters were set`,
    /appliedWindow !== null\s*\?\s*t\('audit\.empty\.inWindow'\)/.test(strip(source)),
  );
}

/*
 * AND THE DICTIONARIES CARRY IT, IN BOTH LANGUAGES. See the comment above: the
 * screens naming a key is half the guarantee, and the type system supplies the
 * other half only as far as EXISTENCE.
 */
checkTrue(
  'the ENGLISH empty-window title names the window',
  /'audit\.empty\.inWindow': 'No records in this window\.'/.test(i18nSource),
);
checkTrue(
  'the ARABIC empty-window title names the window',
  /'audit\.empty\.inWindow': '[^']*هذا النطاق/.test(i18nSource),
);
checkTrue(
  'and both say records outside it were not searched',
  /'audit\.empty\.windowNotSearched':\s*\n?\s*'[^']*were not searched/.test(i18nSource) &&
    /'orgAudit\.empty\.windowNotSearched':\s*\n?\s*'[^']*were not searched/.test(i18nSource) &&
    [...i18nSource.matchAll(/'(?:audit|orgAudit)\.empty\.windowNotSearched':\s*\n?\s*'([^']*)'/gu)]
      .filter((match) => /لم يُبحث/.test(match[1])).length === 2,
);

/* NO PREFETCH. Every window is 2 control-plane row-writes on a 600/day ceiling. */
for (const name of ['PlatformAudit.tsx', 'OrganizationAudit.tsx']) {
  const source = strip(readScreen(name));
  check(
    `${name}: the shift fires no request`,
    /shiftWindow[\s\S]{0,300}(setNonce|listPlatformAudit|listOrganizationAudit)/.test(source),
    false,
  );
}

/*
 * ===========================================================================
 * NO SENTENCE MAY PROMISE THE CONTROL MOVES BY A MONTH
 * ===========================================================================
 *
 * The shift was a calendar-month shift, and changing it to shift by the
 * window's own length TURNED NOTHING RED — while leaving two sentences behind
 * that still described the old behaviour: the too-wide refusal said the
 * controls "move the range by a month", and the empty state said "Move the
 * range back a month to keep looking." Both were found by reading, not by a
 * check, which is `workflow.md` §12 exactly: the code moved and the assertions
 * about it did not.
 *
 * A MONTH-PROMISE IS WRONG FOR ANY WINDOW THAT IS NOT A MONTH LONG, and an
 * operator investigating in fortnights would be told the button does something
 * it does not. Advice to SEARCH a month at a time is still true and is not what
 * this matches — only a claim about what the control MOVES.
 */
const monthPromise = /\b(move|moves|moving|shift|shifts|shifting)\b[^.]{0,80}\b(a|one) (calendar )?month\b/i;

for (const [label, prose] of [
  ['PlatformAudit.tsx', strip(readScreen('PlatformAudit.tsx'))],
  ['OrganizationAudit.tsx', strip(readScreen('OrganizationAudit.tsx'))],
  [
    'audit-window.ts',
    strip(readFileSync(join(import.meta.dirname, '..', 'src', 'api', 'audit-window.ts'), 'utf8')),
  ],
]) {
  check(
    `${label}: no sentence claims the control moves by a month`,
    monthPromise.test(prose.replace(/\s+/g, ' ')),
    false,
  );
}

/* THE KNOWN-FAILING INPUT: the exact sentence that was shipped and was wrong. */
checkTrue(
  'NEGATIVE CONTROL: the month-promise detector catches the sentence that was actually there',
  monthPromise.test('Move the range back a month to keep looking.'),
);
checkTrue(
  'NEGATIVE CONTROL: and the other one',
  monthPromise.test('the controls below move the range by a month without retyping it'),
);
check(
  'NEGATIVE CONTROL: advice to SEARCH a month at a time is not a month-promise',
  monthPromise.test('Search a month at a time and walk backwards.'),
  false,
);

/* =========================================================================
   14. THE TRANSCRIBED CONSTANT, ASSERTED AGAINST THE CONTRACT FILE
   ========================================================================= */

/*
 * ===========================================================================
 * WHY: `MAX_WINDOW_DAYS = 31` IS A NUMBER COPIED OUT OF A DOCUMENT
 * ===========================================================================
 *
 * The 31-day span limit now exists in at least three places — this contract,
 * Core's validator, and `audit-window.ts`'s constant — and until this section
 * existed, NOTHING COMPARED THEM. If the limit narrows to 14, this console goes
 * on refusing at 31 and an operator meets Core's refusal for a request the
 * screen said was fine. That is the permission-catalog transcription problem in
 * a new place.
 *
 * WHAT THIS CLOSES AND WHAT IT DOES NOT. It binds the console's constant to the
 * CONTRACT. It does NOT bind either to Core's validator — if Core's code and
 * Core's contract disagree, every check below stays green. The remaining gap is
 * real and is narrower than the one before it.
 *
 * IT READS THE CONTRACT, WHICH IS READ-ONLY TO THIS AGENT. Nothing here writes,
 * and the contract is the source of truth by construction.
 *
 * THE ANCHORS ARE FOUR INDEPENDENT SENTENCES, on purpose. A single anchor could
 * be deleted by a rewrite and the check would go quiet; four have to be edited
 * together, and the floor below turns a MISSING anchor red rather than absent.
 */

console.log('\n=== The 31-day constant, checked against the contract ===\n');

const AUDIT_CONTRACT_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'contracts',
  'core',
  'platform',
  'platform-audit-read-v1.contract.yaml',
);

/*
 * The contract states the limit ONCE IN WORDS AND THREE TIMES IN DIGITS. The
 * spelled form is in the most normative sentence of the section — the ruling —
 * and it carries no digit at all, so a digits-only check would not read it.
 */
const SPELLED_UNITS = [
  '', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
  'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN',
  'EIGHTEEN', 'NINETEEN',
];
const SPELLED_TENS = [
  '', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY',
];

function spellDays(days) {
  if (!Number.isInteger(days) || days < 1 || days > 99) return null;
  if (days < 20) return SPELLED_UNITS[days];
  const tens = SPELLED_TENS[Math.floor(days / 10)];
  const unit = days % 10;
  return unit === 0 ? tens : `${tens}-${SPELLED_UNITS[unit]}`;
}

check('spellDays(31)', spellDays(31), 'THIRTY-ONE');
check('spellDays(14)', spellDays(14), 'FOURTEEN');
check('spellDays(7)', spellDays(7), 'SEVEN');
check('spellDays(90)', spellDays(90), 'NINETY');
check('spellDays refuses 0', spellDays(0), null);
check('spellDays refuses 100', spellDays(100), null);

function contractAnchors(maxDays) {
  const max = String(maxDays);
  const overMax = String(maxDays + 1);
  return [
    {
      name: 'the ruling — "the span must not exceed THIRTY-ONE DAYS"',
      pattern: /span must not exceed ([A-Z]+(?:-[A-Z]+)?) DAYS/,
      expect: [spellDays(maxDays)],
    },
    {
      name: 'the refusal rule — "A span exceeding 31 days is `invalid_argument`"',
      pattern: /A span exceeding (\d+) days is `invalid_argument`/,
      expect: [max],
    },
    {
      name: 'the request spec — "SPAN AT MOST 31 DAYS"',
      pattern: /SPAN AT MOST (\d+) DAYS/,
      expect: [max],
    },
    {
      name: 'the QA boundary — "32 days is refused; 31 days exactly is accepted"',
      pattern:
        /A span of (\d+) days is refused with `time_window_too_wide`; (\d+) days exactly is accepted/,
      expect: [overMax, max],
    },
  ];
}

/** `ok`, `mismatch` (the sentence is there and disagrees), or `missing`. */
function evaluateContract(text, maxDays) {
  return contractAnchors(maxDays).map((anchor) => {
    const found = anchor.pattern.exec(text);
    if (found === null) return { name: anchor.name, status: 'missing', found: null };
    const captured = found.slice(1);
    const agrees =
      captured.length === anchor.expect.length &&
      captured.every((value, index) => value === anchor.expect[index]);
    return { name: anchor.name, status: agrees ? 'ok' : 'mismatch', found: captured.join(', ') };
  });
}

let auditContractText = null;
try {
  auditContractText = readFileSync(AUDIT_CONTRACT_PATH, 'utf8');
} catch {
  auditContractText = null;
}
checkTrue(
  'the contract is readable at the path this check assumes',
  auditContractText !== null && auditContractText.length > 0,
);

const contractResults = evaluateContract(auditContractText ?? '', MAX_WINDOW_DAYS);
for (const result of contractResults) {
  check(
    `contract agrees with MAX_WINDOW_DAYS: ${result.name}`,
    result.status === 'ok' ? 'ok' : `${result.status}: ${String(result.found)}`,
    'ok',
  );
}

/*
 * THE FLOOR. "No findings" must not render as "no input" — an anchor set that
 * matches nothing would otherwise report four silent passes, which is the most
 * confident wrong answer a check can give.
 */
check(
  'all four statements of the limit were FOUND, not merely not-contradicted',
  contractResults.filter((result) => result.status !== 'missing').length,
  4,
);

/*
 * ===========================================================================
 * NEGATIVE CONTROLS — the known-failing inputs, without which this is observed
 * rather than verified
 * ===========================================================================
 */

/* 1. The drift this exists to catch: the console's constant narrowed to 14. */
const driftedResults = evaluateContract(auditContractText ?? '', 14);
check(
  'NEGATIVE CONTROL: a console constant of 14 is caught by all four anchors',
  driftedResults.filter((result) => result.status === 'mismatch').length,
  4,
);
check(
  'NEGATIVE CONTROL: and none of them passes',
  driftedResults.filter((result) => result.status === 'ok').length,
  0,
);

/* 2. Handed nothing, it must fail LOUDLY rather than find nothing wrong. */
const emptyResults = evaluateContract('', MAX_WINDOW_DAYS);
check(
  'NEGATIVE CONTROL: an empty contract reports four MISSING',
  emptyResults.filter((result) => result.status === 'missing').length,
  4,
);
check(
  'NEGATIVE CONTROL: and reports nothing as ok',
  emptyResults.filter((result) => result.status === 'ok').length,
  0,
);

/*
 * 3. The boundary is asserted as MAX + 1, not merely captured. Without this,
 *    the QA anchor would pass against a contract that had moved the refused
 *    span while leaving the accepted one alone.
 */
const movedBoundary = (auditContractText ?? '').replace(
  'A span of 32 days is refused',
  'A span of 33 days is refused',
);
checkTrue(
  'NEGATIVE CONTROL: the boundary mutation actually applied (a no-op control controls nothing)',
  auditContractText !== null && movedBoundary !== auditContractText,
);
check(
  'NEGATIVE CONTROL: a contract refusing at 33 rather than 32 goes red',
  evaluateContract(movedBoundary, MAX_WINDOW_DAYS)[3].status,
  'mismatch',
);

/* =========================================================================
   15. ORGANIZATION IDENTITY — organization-identity-v1
   ========================================================================= */

console.log('\n=== The three registration states stay three ===\n');

/*
 * THE STATE THAT MUST NOT COLLAPSE. `not_recorded` and `not_registered` are
 * different facts — "we never asked" versus "they told us they have none" —
 * and merging them destroys the ability to decide whether to prompt, and to
 * defend the record afterwards.
 */
const NOT_RECORDED = { state: 'not_recorded' };
const NOT_REGISTERED = { state: 'not_registered', declared_at: '2026-09-07T09:00:00.000Z' };
const REGISTERED_UNVERIFIED = {
  state: 'registered',
  number: 'CR-1234567',
  recorded_at: '2026-09-07T09:00:00.000Z',
  verification: null,
};
const REGISTERED_VERIFIED = {
  ...REGISTERED_UNVERIFIED,
  verification: {
    verified_by_principal_id: 'pr_synthetic_00000001',
    verified_at: '2026-09-07T09:30:00.000Z',
  },
};

check('not_recorded parses', parseRegistrationRecord(NOT_RECORDED, 'x').state, 'not_recorded');

const declared = parseRegistrationRecord(NOT_REGISTERED, 'x');
check('not_registered parses', declared.state, 'not_registered');
check(
  'and carries declared_at, which is what separates it from not_recorded',
  declared.state === 'not_registered' ? declared.declared_at : null,
  '2026-09-07T09:00:00.000Z',
);
checkTrue(
  'a not_registered WITHOUT declared_at is REFUSED, not read as an undated declaration',
  (() => {
    try {
      parseRegistrationRecord({ state: 'not_registered' }, 'x');
      return false;
    } catch {
      return true;
    }
  })(),
);

const unverified = parseRegistrationRecord(REGISTERED_UNVERIFIED, 'x');
check('registered parses', unverified.state, 'registered');
check(
  'a null verification stays NULL — recorded but unchecked is its own state',
  unverified.state === 'registered' ? unverified.verification : 'wrong',
  null,
);

const verified = parseRegistrationRecord(REGISTERED_VERIFIED, 'x');
check(
  'a verification carries WHO',
  verified.state === 'registered' ? verified.verification?.verified_by_principal_id : null,
  'pr_synthetic_00000001',
);
check(
  'and WHEN',
  verified.state === 'registered' ? verified.verification?.verified_at : null,
  '2026-09-07T09:30:00.000Z',
);

/*
 * `verification` IS REQUIRED AND NULLABLE, NOT OPTIONAL. An absent key is a
 * contract violation and is refused rather than read as null, because "recorded
 * but unverified" and "this response is not the shape it claims" are different
 * facts and only one of them is safe to render.
 */
checkTrue(
  'a registered record with NO verification key is refused, not defaulted to null',
  (() => {
    try {
      parseRegistrationRecord(
        { state: 'registered', number: 'X1', recorded_at: '2026-09-07T09:00:00.000Z' },
        'x',
      );
      return false;
    } catch {
      return true;
    }
  })(),
);

/*
 * AN UNKNOWN STATE IS CARRIED, NOT MAPPED ONTO `not_recorded`. Telling an
 * operator nobody had asked, when the truth is that this build cannot read the
 * answer, is a false statement about a customer.
 */
const unknownState = parseRegistrationRecord({ state: 'provisional' }, 'x');
check('an unknown state is reported as unrecognised', unknownState.state, 'unrecognised');
check(
  'and keeps the raw value so it can be shown verbatim',
  unknownState.state === 'unrecognised' ? unknownState.raw : null,
  'provisional',
);
check('not_recorded is a known state', isKnownRegistrationState('not_recorded'), true);
check('an invented state is NOT claimed as known', isKnownRegistrationState('provisional'), false);

console.log('\n=== The identity block, and the detail response that embeds it ===\n');

const IDENTITY_BODY = {
  display_name: 'Al Noor Trading',
  commercial_registration: REGISTERED_VERIFIED,
  vat_registration: NOT_REGISTERED,
};

const identity = parseOrganizationIdentity(IDENTITY_BODY, 'x');
check('display_name is read', identity.display_name, 'Al Noor Trading');
check('a null display_name stays null', parseOrganizationIdentity({ ...IDENTITY_BODY, display_name: null }, 'x').display_name, null);
check('the CR is read', identity.commercial_registration.state, 'registered');
check('the VAT is read', identity.vat_registration.state, 'not_registered');
checkTrue(
  'an identity block missing a registration is REFUSED — both are required',
  (() => {
    try {
      parseOrganizationIdentity({ display_name: null, commercial_registration: NOT_RECORDED }, 'x');
      return false;
    } catch {
      return true;
    }
  })(),
);

const DETAIL_WITH_IDENTITY = {
  organization_id: 'og_synthetic_0000000001',
  status: 'active',
  created_at: '2026-09-01T00:00:00.000Z',
  display_name: 'Al Noor Trading',
  commercial_registration: REGISTERED_UNVERIFIED,
  vat_registration: NOT_RECORDED,
  template: null,
  member_count: 3,
};
const detailWithIdentity = parseOrganizationDetail(DETAIL_WITH_IDENTITY);
check('the detail response carries the name', detailWithIdentity.display_name, 'Al Noor Trading');
check('and the CR', detailWithIdentity.commercial_registration.state, 'registered');
check('and the VAT', detailWithIdentity.vat_registration.state, 'not_recorded');

console.log('\n=== Local shape refusals — every one is about what was just typed ===\n');

check('a plain name is accepted', displayNameRefusal('Al Noor Trading'), null);
checkTrue('an empty name is refused', displayNameRefusal('') !== null);
checkTrue('a padded name is refused, not trimmed', displayNameRefusal(' Al Noor ') !== null);
checkTrue('a trailing-space name is refused', displayNameRefusal('Al Noor ') !== null);
check('a name at the bound is accepted', displayNameRefusal('A'.repeat(MAX_DISPLAY_NAME_LENGTH)), null);
checkTrue(
  'one character over the bound is refused',
  displayNameRefusal('A'.repeat(MAX_DISPLAY_NAME_LENGTH + 1)) !== null,
);

check('a plain registration number is accepted', registrationNumberRefusal('1234567'), null);
check('interior spaces are accepted', registrationNumberRefusal('CR 123 456'), null);
check('interior hyphens are accepted', registrationNumberRefusal('CR-123-456'), null);
checkTrue('a leading space is refused', registrationNumberRefusal(' 123') !== null);
checkTrue('a trailing hyphen is refused', registrationNumberRefusal('123-') !== null);
checkTrue('an empty number is refused', registrationNumberRefusal('') !== null);
check(
  'a number at the bound is accepted',
  registrationNumberRefusal('1'.repeat(MAX_REGISTRATION_NUMBER_LENGTH)),
  null,
);
checkTrue(
  'one character over the bound is refused',
  registrationNumberRefusal('1'.repeat(MAX_REGISTRATION_NUMBER_LENGTH + 1)) !== null,
);

/*
 * =========================================================================
 * AND NOW *WHICH* REFUSAL, WHICH THESE COULD NOT ASK BEFORE
 * =========================================================================
 *
 * Every assertion above is `!== null` — *something was refused*. **A bug that
 * returned the "remove the spaces" sentence for a name that is merely too long
 * would pass all of them**, and the operator would be told to fix padding that
 * is not there.
 *
 * That was not laziness: while the functions returned prose, asking which
 * refusal meant matching English, which is the transcription that has broken
 * six checks today. **Returning a discriminated key is what makes the sharper
 * question cheap**, so it is asked now.
 */
{
  const keyOf = (refusal) => refusal?.key ?? null;
  check('an empty name names the empty refusal', keyOf(displayNameRefusal('')), 'refusal.displayName.empty');
  check(
    'a padded name names the PADDING refusal, not the length one',
    keyOf(displayNameRefusal(' Al Noor ')),
    'refusal.displayName.padded',
  );
  check(
    'and an over-long name names the LENGTH one',
    keyOf(displayNameRefusal('A'.repeat(MAX_DISPLAY_NAME_LENGTH + 1))),
    'refusal.displayName.tooLong',
  );
  check(
    'a bad-shaped number names the pattern refusal',
    keyOf(registrationNumberRefusal(' 123')),
    'refusal.registration.pattern',
  );
  check(
    'an over-long number names the length one',
    keyOf(registrationNumberRefusal('1'.repeat(MAX_REGISTRATION_NUMBER_LENGTH + 1))),
    'refusal.registration.tooLong',
  );
  check(
    'a padded template name names the padding refusal',
    keyOf(templateNameRefusal('School ')),
    'refusal.templateName.padded',
  );
  check(
    'and an over-long template name names the length one',
    keyOf(templateNameRefusal('S'.repeat(MAX_TEMPLATE_NAME_LENGTH + 1))),
    'refusal.templateName.tooLong',
  );

  /*
   * THE NUMBERS TRAVEL WITH THE REFUSAL, DERIVED RATHER THAN TYPED. A dictionary
   * carrying `120` instead of `{max}` would be a second copy of the constant in
   * the file least likely to be re-derived when it moves (`§12`) — and it would
   * be wrong in BOTH languages at once.
   */
  const tooLong = displayNameRefusal('A'.repeat(MAX_DISPLAY_NAME_LENGTH + 3));
  check('the length refusal carries the limit', tooLong?.values?.max, MAX_DISPLAY_NAME_LENGTH);
  check('and what was actually typed', tooLong?.values?.length, MAX_DISPLAY_NAME_LENGTH + 3);
  check(
    'and the two differ, so the sentence is worth printing',
    tooLong?.values?.max === tooLong?.values?.length,
    false,
  );

  /*
   * EVERY REFUSAL RESOLVES IN BOTH LANGUAGES, and every sentence naming a number
   * carries the placeholder rather than a numeral. The population is printed, so
   * a walk that stopped finding refusals cannot read as a clean sweep.
   */
  const enBlock = /export const en = \{([\s\S]*?)\n\} as const;/u.exec(i18nSource)?.[1] ?? '';
  const arBlock =
    /export const ar: Record<MessageKey, string> = \{([\s\S]*?)\n\};/u.exec(i18nSource)?.[1] ?? '';
  const entryIn = (block, key) =>
    new RegExp(`'${key.replace(/\./gu, '\\.')}':\\s*\\n?\\s*'([^']*)'`, 'u').exec(block)?.[1] ?? '';

  const probes = [
    displayNameRefusal(''),
    displayNameRefusal(' x '),
    displayNameRefusal('A'.repeat(MAX_DISPLAY_NAME_LENGTH + 1)),
    registrationNumberRefusal(''),
    registrationNumberRefusal(' 123'),
    registrationNumberRefusal('1'.repeat(MAX_REGISTRATION_NUMBER_LENGTH + 1)),
    templateNameRefusal(''),
    templateNameRefusal('x '),
    templateNameRefusal('S'.repeat(MAX_TEMPLATE_NAME_LENGTH + 1)),
    templateLabelRefusal('x '),
    templateLabelRefusal('C'.repeat(MAX_TEMPLATE_LABEL_LENGTH + 1)),
  ].filter((refusal) => refusal !== null);
  console.log(`  … ${String(probes.length)} distinct field refusals reached`);
  checkTrue('every refusal branch was exercised', probes.length === 11);

  const unresolved = [];
  const missingPlaceholder = [];
  for (const refusal of probes) {
    for (const [label, block] of [
      ['en', enBlock],
      ['ar', arBlock],
    ]) {
      const sentence = entryIn(block, refusal.key);
      if (sentence === '') unresolved.push(`${label}:${refusal.key}`);
      for (const name of Object.keys(refusal.values ?? {})) {
        if (!sentence.includes(`{${name}}`)) missingPlaceholder.push(`${label}:${refusal.key}:${name}`);
      }
    }
  }
  check('every field refusal resolves in both languages', unresolved.join(','), '');
  check('and every number it carries has a placeholder to land in', missingPlaceholder.join(','), '');
}

/*
 * *** THERE IS NO DIGIT COUNT, AND THE ABSENCE IS A RULING RATHER THAN AN
 * OMISSION. *** Bahrain VAT account numbers are widely reported as fifteen
 * digits; that figure comes from secondary sources and is deliberately NOT in
 * the pattern. A PATTERN IS A REFUSAL — an at-count pattern that is wrong
 * refuses a LEGAL registration, and the failure lands on a customer who cannot
 * be onboarded and an operator whose only remedy is to invent a value.
 *
 * THIS CHECK EXISTS TO FAIL IF SOMEBODY NARROWS IT. Narrowing is BREAKING under
 * API_STANDARD.md §6 and requires a decision record citing the issuing
 * authority by document and date; a console that narrowed it locally would
 * produce exactly that refusal with none of that record.
 */
for (const plausible of ['1', '12', '123456789012345', '1234567890123456', 'A1', 'GB-99-X']) {
  check(`no digit count is imposed: ${plausible} is accepted`, registrationNumberRefusal(plausible), null);
}

console.log('\n=== The update sends a DIFF, and never an empty body ===\n');

{
  const sent = [];
  const { impl, calls } = stubFetch(jsonResponse(IDENTITY_BODY));
  const client = createPlatformClient({ fetchImpl: impl });
  await client.updateOrganizationIdentity('og_synthetic_0000000001', {
    display_name: 'Al Noor Trading',
  });
  const request = calls[0];
  sent.push(request);
  check(
    'the path carries the Organization and ends in /identity',
    request.url,
    '/api/v1/platform/organizations/og_synthetic_0000000001/identity',
  );
  check('the method is PATCH', request.init.method, 'PATCH');
  check(
    'only the changed field is sent',
    Object.keys(JSON.parse(request.init.body)).join(','),
    'display_name',
  );
}

{
  const { impl } = stubFetch(jsonResponse(IDENTITY_BODY));
  const client = createPlatformClient({ fetchImpl: impl });
  const both = await (async () => {
    const { impl: impl2, calls } = stubFetch(jsonResponse(IDENTITY_BODY));
    const c2 = createPlatformClient({ fetchImpl: impl2 });
    await c2.updateOrganizationIdentity('og_a', {
      commercial_registration: { state: 'registered', number: 'CR1', verified: false },
      vat_registration: { state: 'not_registered' },
    });
    return JSON.parse(calls[0].init.body);
  })();
  check(
    'two registrations send exactly two fields',
    Object.keys(both).sort().join(','),
    'commercial_registration,vat_registration',
  );
  check('the registration input carries no server-stamped field', Object.keys(both.commercial_registration).sort().join(','), 'number,state,verified');
  check('and not_registered carries only its state', Object.keys(both.vat_registration).join(','), 'state');
  /* Keeps `client` referenced so the stub above is not mistaken for dead code. */
  checkTrue('the client exposes the update method', typeof client.updateOrganizationIdentity === 'function');
}

/*
 * AN EMPTY BODY IS NEVER SENT. `minProperties: 1` — "a no-op here still writes a
 * platform audit record and FIVE ROW-WRITES INTO THE CUSTOMER'S OWN DAILY
 * ALLOCATION, and a request that spends a customer's budget to change nothing is
 * a request that should not have been accepted." So this refuses locally rather
 * than earning the refusal, and the condition is about the SHAPE of the request
 * rather than any fact about data.
 */
{
  const { impl, calls } = stubFetch(jsonResponse(IDENTITY_BODY));
  const client = createPlatformClient({ fetchImpl: impl });
  await checkThrows(
    'an empty update is refused locally',
    () => client.updateOrganizationIdentity('og_a', {}),
    'invalid_argument',
  );
  check('and no request was made at all', calls.length, 0);
}

console.log('\n=== The bounds, asserted against the schema file ===\n');

/*
 * THE SAME TREATMENT `MAX_WINDOW_DAYS` GETS, FOR THE SAME REASON: a number
 * copied out of a document is a claim that was true when it was copied. Here the
 * source is JSON, so the anchors are property paths rather than sentences.
 *
 * IT READS THE `.schema.json` AND NOT THE `.contract.yaml`. The YAML was being
 * edited by another agent while this was written; the schema is committed and
 * clean, and the field shapes are what it carries.
 *
 * WHAT THIS DOES NOT CLOSE: it binds the console to the CONTRACT, not to Core's
 * validator. If Core's code and Core's contract disagree, these checks stay
 * green.
 */
const IDENTITY_SCHEMA_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'contracts',
  'core',
  'platform',
  'organization-identity-v1.schema.json',
);

let identitySchema = null;
try {
  identitySchema = JSON.parse(readFileSync(IDENTITY_SCHEMA_PATH, 'utf8'));
} catch {
  identitySchema = null;
}
checkTrue('the identity schema is readable at the path this check assumes', identitySchema !== null);

/**
 * Reads one constraint, distinguishing MISSING from a value.
 *
 * "No findings" must not render as "no input": a renamed `$defs` entry returns
 * the string `missing`, which fails loudly, rather than `undefined`, which
 * compares equal to nothing and would pass against a constant that was also
 * undefined.
 */
function schemaConstraint(defName, keyword) {
  const def = identitySchema?.$defs?.[defName];
  if (def === undefined) return `missing $defs.${defName}`;
  if (!(keyword in def)) return `missing $defs.${defName}.${keyword}`;
  return def[keyword];
}

check(
  'MAX_DISPLAY_NAME_LENGTH matches displayName.maxLength',
  schemaConstraint('displayName', 'maxLength'),
  MAX_DISPLAY_NAME_LENGTH,
);
check(
  'MAX_REGISTRATION_NUMBER_LENGTH matches registrationNumber.maxLength',
  schemaConstraint('registrationNumber', 'maxLength'),
  MAX_REGISTRATION_NUMBER_LENGTH,
);
check(
  'the registration-number pattern is the schema’s, character for character',
  schemaConstraint('registrationNumber', 'pattern'),
  '^[A-Za-z0-9]([A-Za-z0-9 -]*[A-Za-z0-9])?$',
);
check(
  'the display-name pattern is the schema’s, character for character',
  schemaConstraint('displayName', 'pattern'),
  '^[^\\s].*[^\\s]$|^[^\\s]$',
);
check('a display name of zero characters is refused by the schema too', schemaConstraint('displayName', 'minLength'), 1);

/*
 * THE THREE STATES ARE THE SCHEMA'S THREE, ENUMERATED FROM IT RATHER THAN
 * ASSERTED FROM MEMORY. A fourth arriving in the contract turns this red, which
 * is the signal to teach the console about it — rather than the console
 * silently rendering it as `unrecognised` forever.
 */
const schemaStates = (identitySchema?.$defs?.registrationRecord?.oneOf ?? []).map(
  (branch) => branch?.properties?.state?.const ?? 'missing',
);
check(
  'the record states are exactly the three this console knows',
  schemaStates.join(','),
  'not_recorded,not_registered,registered',
);
const schemaInputStates = (identitySchema?.$defs?.registrationInput?.oneOf ?? []).map(
  (branch) => branch?.properties?.state?.const ?? 'missing',
);
check(
  'and the INPUT states are the same three',
  schemaInputStates.join(','),
  'not_recorded,not_registered,registered',
);

/*
 * NO SERVER-STAMPED FIELD IS SENDABLE. `declared_at`, `recorded_at`,
 * `verified_by_principal_id` and `verified_at` are all set by Core — "provenance
 * a caller supplies is not provenance". This asserts the SCHEMA forbids them,
 * and the request-shape check above asserts this client does not send them.
 */
const inputProperties = new Set(
  (identitySchema?.$defs?.registrationInput?.oneOf ?? []).flatMap((branch) =>
    Object.keys(branch?.properties ?? {}),
  ),
);
for (const stamped of ['declared_at', 'recorded_at', 'verified_by_principal_id', 'verified_at']) {
  check(`the input shape has no ${stamped}`, inputProperties.has(stamped), false);
}
check(
  'the input properties are exactly state, number and verified',
  [...inputProperties].sort().join(','),
  'number,state,verified',
);

/*
 * NEGATIVE CONTROLS. Without a known-failing input this section is observed
 * rather than verified — and both of these would have gone green against a
 * broken reader.
 */
check(
  'NEGATIVE CONTROL: a renamed $defs entry reads as MISSING, not as undefined',
  schemaConstraint('displayNameXX', 'maxLength'),
  'missing $defs.displayNameXX',
);
check(
  'NEGATIVE CONTROL: an absent keyword reads as MISSING',
  schemaConstraint('displayName', 'maxItems'),
  'missing $defs.displayName.maxItems',
);
checkTrue(
  'NEGATIVE CONTROL: the bound check would fail against a wrong constant',
  schemaConstraint('displayName', 'maxLength') !== MAX_DISPLAY_NAME_LENGTH + 1,
);

console.log('\n=== display_name: no placeholder is ever invented ===\n');

/*
 * *** AN INVENTED NAME IS INDISTINGUISHABLE FROM A TYPED ONE, FOREVER. *** The
 * contract binds both clients: render `organization_id` verbatim when
 * `display_name` is null — "not a blank, not a dash, not 'Unnamed
 * Organization'." Two consoles inventing two different placeholders is the
 * divergence the one-contract rule exists to prevent.
 */
/*
 * COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT A LOOPHOLE — IT IS THE POINT.
 * The check is about what is RENDERED. Every one of these files QUOTES the
 * prohibition in a comment ("not a blank, not a dash, not 'Unnamed
 * Organization'"), so a check over raw source fails against a file that is
 * correct precisely because it explains the rule. That happened on the first
 * run of this check, and reading the raw source is what made it a false
 * positive rather than a finding.
 */
for (const name of ['Organizations.tsx', 'OrganizationDetail.tsx', 'OnboardOrganization.tsx']) {
  const rendered = strip(readScreen(name)).replace(/\s+/g, ' ');
  for (const placeholder of ['Unnamed Organization', 'Unnamed business', 'No name)', '(unnamed']) {
    check(`${name}: never renders "${placeholder}"`, rendered.includes(placeholder), false);
  }
}

/*
 * THE NEGATIVE CONTROL FOR THE ABOVE, because a check that strips comments
 * could strip everything and then find nothing wrong with an empty string.
 * These assert the detector fires on the thing it is looking for and that the
 * stripped source is not empty.
 */
checkTrue(
  'NEGATIVE CONTROL: the placeholder detector fires on a screen that DOES invent one',
  strip('<p>Unnamed Organization</p>').replace(/\s+/g, ' ').includes('Unnamed Organization'),
);
for (const name of ['Organizations.tsx', 'OrganizationDetail.tsx', 'OnboardOrganization.tsx']) {
  checkTrue(
    `NEGATIVE CONTROL: ${name} still has renderable source after stripping comments`,
    strip(readScreen(name)).replace(/\s+/g, ' ').length > 500,
  );
}

const identityPanel = readFileSync(
  join(import.meta.dirname, '..', 'src', 'components', 'OrganizationIdentity.tsx'),
  'utf8',
);
/*
 * COMMENTS STRIPPED BEFORE EVERY ASSERTION BELOW, INCLUDING THE POSITIVE ONES.
 * This file explains each rule at length in prose, so a check over raw source
 * could be satisfied by a COMMENT DESCRIBING the sentence rather than by the
 * sentence being on screen — green because the code is well documented, not
 * because it is right. Whitespace is collapsed after, because JSX wraps text at
 * arbitrary points.
 */
const identityCode = strip(identityPanel);
const identityProse = identityCode.replace(/\s+/g, ' ');
checkTrue(
  'FLOOR: the identity panel has renderable source after stripping comments',
  identityProse.length > 2000,
);

/*
 * ⚠ THESE TWO TRANSCRIBED THE ENGLISH TEXT AND WENT RED WHEN THE PANEL WAS
 * TRANSLATED. Rewritten 2026-09-11, and it is the THIRD instance of this exact
 * failure in this file — after `aria-label="Sections"` and the `nonce` grep.
 *
 * **The property has not moved; the string has.** The screen now names a
 * message key and the English lives in the dictionary, so the assertion follows
 * it: **the screen must USE the key, and the message must SAY the thing.**
 *
 * That split is not bureaucratic — it is what makes each half checkable in the
 * place it is true. A check that looked for English in the screen would now be
 * asserting that the screen is untranslated.
 */
checkTrue(
  'the identity panel renders the no-name case as a real state',
  /identity\.noName'/.test(identityProse),
);
checkTrue(
  'and the message says it is normal rather than an error',
  /it is not an error and nothing is missing/.test(i18nSource),
);

/*
 * *** THE VERIFICATION RECORD IS THE POINT, SO IT IS RENDERED. *** The whole
 * argument for this route not being confirmation-gated is that verification
 * acts at the point of harm instead. A screen that shows the number and hides
 * whether anyone checked it destroys that argument.
 */
checkTrue(
  /* Two halves, for the reason above: the screen uses the key, the dictionary carries the words. */
  'an unverified number is visibly unverified',
  /identity\.notVerified'/.test(identityProse) && /'Not verified'/.test(i18nSource),
);
/*
 * ⚠ SIX MORE ENGLISH TRANSCRIPTIONS BROKEN BY TRANSLATION — the seventh through
 * twelfth of that shape today, all in this one block.
 *
 * **AND THIS BLOCK IS WHERE THE PATTERN COSTS MOST**, because every one of these
 * six asserts a DISTINCTION rather than a wording: *not recorded* vs *they have
 * none*, *an answer* vs *a gap*, *a claim* vs *a status*. Those are facts about
 * a customer that a shorter sentence collapses, and the type system cannot see
 * a collapsed sentence — `Record<MessageKey, string>` proves an Arabic value
 * EXISTS, never that it still draws the line.
 *
 * **So all six are pinned in BOTH languages**, like the reset screen's hedge and
 * the audit feeds' window. The screen names the key; the dictionaries carry the
 * distinction; and the Arabic half is a short fragment so ordinary polish does
 * not go red.
 */
checkTrue(
  'and says nobody has confirmed it against the registry',
  /identity\.notVerified\.body/.test(identityProse) &&
    /'identity\.notVerified\.body':\s*\n?\s*'[^']*Nobody has confirmed it against \{registry\}/.test(
      i18nSource,
    ) &&
    /'identity\.notVerified\.body':\s*\n?\s*'[^']*ولم يؤكّده أحد لدى \{registry\}/.test(i18nSource),
);
checkTrue(
  'a verified number names WHO checked it',
  /verification\.verified_by_principal_id/.test(identityProse),
);
checkTrue('and WHEN', /verification\.verified_at/.test(identityProse));

/*
 * NOT CONFIRMATION-GATED, AND THE CONSOLE MUST NOT INVENT A GATE THE LADDER DID
 * NOT PUT THERE. The route is `sensitive`, not `critical`: making a VAT field
 * critical generalises to every field and the rung stops sorting anything.
 */
for (const symbol of ['requestConfirmation', 'ConfirmationGate', 'confirmation_id']) {
  check(`the identity panel does not reach for ${symbol}`, identityCode.includes(symbol), false);
}

/*
 * THE THREE STATES ARE DISTINCT ON SCREEN. `not_registered` is an ANSWER, not a
 * gap — Bahrain VAT registration is voluntary below a threshold — and a console
 * that rendered it as missing data would keep prompting a customer who has
 * already replied.
 */
checkTrue(
  'not_recorded says Dudo does not know, rather than that they have none',
  /identity\.notRecorded\.notNone/.test(identityProse) &&
    /'identity\.notRecorded\.notNone':\s*\n?\s*'[^']*\{kind\} — it means Dudo does not know/.test(
      i18nSource,
    ) &&
    /'identity\.notRecorded\.notNone':\s*\n?\s*'[^']*يعني أنّ دودو لا تعرف/.test(i18nSource),
);
checkTrue(
  'not_registered is rendered as an answer',
  /identity\.notRegistered\.answerNotGap/.test(identityProse) &&
    /'identity\.notRegistered\.answerNotGap':\s*\n?\s*'This is an answer, not a gap/.test(
      i18nSource,
    ) &&
    /'identity\.notRegistered\.answerNotGap':\s*\n?\s*'[^']*جواب لا فراغ/.test(i18nSource),
);
checkTrue(
  'and its date is Dudo’s record of the statement, not their circumstances',
  /identity\.notRegistered\.notCircumstances/.test(identityProse) &&
    /'identity\.notRegistered\.notCircumstances':\s*\n?\s*'[^']*it makes it stale/.test(
      i18nSource,
    ) &&
    /'identity\.notRegistered\.notCircumstances':\s*\n?\s*'[^']*بل يجعله قديمًا/.test(i18nSource),
);

/*
 * EDITING A NUMBER CLEARS ITS VERIFICATION, AND THE FORM SAYS SO BEFORE THE
 * PRESS. A box left ticked from the previous value is an operator claiming to
 * have checked a number they have just replaced — "worse than an unverified
 * number because it defends itself."
 */
checkTrue(
  'the form warns that changing the number clears the verification',
  /identity\.numberChangeClearsVerification'/.test(identityProse) &&
    /Changing the number clears the existing verification\./.test(i18nSource),
);
checkTrue(
  'and the tick is actually withdrawn in code, not merely described',
  /verified: currentNumber !== null && value !== currentNumber \? false : draft\.verified/.test(
    identityCode.replace(/\s+/g, ' '),
  ),
);
/*
 * ⚠ THE GRAMMATICAL PERSON IS THE PROPERTY, AND IT IS THE ONE MOST LIKELY TO BE
 * LOST IN TRANSLATION WITHOUT ANYBODY NOTICING.
 *
 * *"I have checked this number against X"* is a claim the operator makes and
 * Dudo attributes to them, with their principal id and today's date. **"Verified
 * against X" reads as something the system knows — and nothing checks it,
 * because there is no registry API.** A translator reaching for the shorter,
 * more natural label would erase the distinction this whole component exists to
 * keep, and every type in the console would still be satisfied.
 *
 * So the Arabic is pinned on its first-person marker (لقد تحقّقت) as well.
 */
checkTrue(
  'the verified control is worded as a first-person claim, not a status',
  /identity\.verifyClaim/.test(identityProse) &&
    /'identity\.verifyClaim':\s*\n?\s*'I have checked this number against \{registry\}/.test(
      i18nSource,
    ) &&
    /'identity\.verifyClaim':\s*\n?\s*'لقد تحقّقت من هذا الرقم لدى \{registry\}/.test(i18nSource),
);
checkTrue(
  'and says nothing checks it for the operator',
  /identity\.verifyClaim\.what/.test(identityProse) &&
    /'identity\.verifyClaim\.what':\s*\n?\s*'[^']*Nothing checks this for you\./.test(i18nSource) &&
    /'identity\.verifyClaim\.what':\s*\n?\s*'[^']*لا شيء يتحقّق من ذلك نيابةً عنك/.test(i18nSource),
);

console.log('\n=== Onboarding: no field is offered that would be discarded ===\n');

const onboardSource = readScreen('OnboardOrganization.tsx');
const onboardCode = strip(onboardSource);

/*
 * THE CONTRACT HAS NO CR AND NO VAT AT ONBOARDING. `onboardOrganizationInput`
 * is `additionalProperties: false` over five fields, and every Organization
 * starts `not_recorded`. A form that collected them would be collecting values
 * it cannot send.
 */
for (const field of ['commercial_registration', 'vat_registration']) {
  check(`onboarding never sends ${field}`, onboardCode.includes(field), false);
}

/*
 * `display_name` IS OFFERED AND IS OPTIONAL. It was briefly unsendable —
 * `platform.organizations.create` declared four fields and `display_name` was
 * not among them, while `organization-onboarding-v1.schema.json` published it,
 * and the class refuses undeclared fields BEFORE AUTHENTICATION. Core landed
 * the field on 2026-09-07 and the divergence is closed.
 *
 * THE GATE THAT HELD IT SHUT IS DELETED RATHER THAN PINNED TO `true`, and so
 * are the checks that guarded it. A flag that can no longer move keeps an
 * unreachable branch alive, and the unreachable half here was a paragraph
 * telling operators the name is recorded elsewhere — which is now FALSE. Dead
 * prose in a client is a stale assertion waiting for somebody to re-enable it.
 */
/*
 * ⚠ ANOTHER ENGLISH TRANSCRIPTION, BROKEN BY THE ARABIC PASS — the sixth. It
 * matched `label="Business name — optional"` against the screen; the screen now
 * names a key. Split as the others were, and **the word "optional" is the part
 * that has to survive**: `0031` makes the field optional on the write path, and
 * a label that stopped saying so would make an operator believe they cannot
 * onboard without a name they may not have.
 */
checkTrue(
  'the name field is offered',
  /label=\{t\('onboard\.nameLabel'\)\}/.test(onboardCode),
);
checkTrue(
  'and BOTH dictionaries label it optional',
  /'onboard\.nameLabel': 'Business name — optional'/.test(i18nSource) &&
    /'onboard\.nameLabel': '[^']*اختياري'/.test(i18nSource),
);
check(
  'no gate remains that could hide it',
  /CONSOLE_MAY_SEND_DISPLAY_NAME/.test(onboardSource),
  false,
);
check(
  'and the paragraph saying the name is recorded elsewhere is gone with it',
  /The business is named on its own page, not here/.test(onboardSource.replace(/\s+/g, ' ')),
  false,
);

/*
 * THE CLIENT OMITS AN EMPTY NAME RATHER THAN SENDING `''`. "Absent" and
 * "present and empty" are different requests and `minLength: 1` accepts only
 * one of them — an empty string would turn a blank optional field into a
 * validation error.
 */
{
  const { impl, calls } = stubFetch(
    jsonResponse({
      organization_id: 'og_a',
      admin_principal_id: 'pr_a',
      workspace_id: 'ws_a',
      warnings: [],
    }),
  );
  const client = createPlatformClient({ fetchImpl: impl });
  await client.onboardOrganization({
    admin_identifier: 'admin@example.com',
    template_id: 'tp_a',
    derived_value: 'a'.repeat(43),
    display_name: '',
  });
  check(
    'an empty display_name is OMITTED, not sent as an empty string',
    Object.keys(JSON.parse(calls[0].init.body)).sort().join(','),
    'admin_identifier,derived_value,first_workspace_name,template_id',
  );
}

{
  const { impl, calls } = stubFetch(
    jsonResponse({
      organization_id: 'og_a',
      admin_principal_id: 'pr_a',
      workspace_id: 'ws_a',
      warnings: [],
    }),
  );
  const client = createPlatformClient({ fetchImpl: impl });
  await client.onboardOrganization({
    admin_identifier: 'admin@example.com',
    template_id: 'tp_a',
    derived_value: 'a'.repeat(43),
    display_name: 'Al Noor Trading',
  });
  const body = JSON.parse(calls[0].init.body);
  check('a typed display_name IS sent', body.display_name, 'Al Noor Trading');
  check(
    'and the workspace placeholder is still a separate field',
    body.first_workspace_name,
    DISCARDED_WORKSPACE_NAME_PLACEHOLDER,
  );
}

console.log('');
if (failures > 0) {
  console.error(`${String(failures)} check(s) FAILED.`);
  process.exit(1);
}
console.log('All checks passed.');
